/**
 * pi-exec phase runner — executes a single phase as a bounded conversation.
 *
 * The phase conversation grows within bounds (phaseBudget + maxPhaseRounds),
 * then gets discarded. Only the state from done() carries forward.
 */

import { streamSimple, completeSimple } from "@mariozechner/pi-ai";
import type {
  Model,
  Message,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  SimpleStreamOptions,
  Tool,
  ToolCall,
} from "@mariozechner/pi-ai";
import type {
  Phase,
  State,
  PhaseResult,
  ExecutorConfig,
  OnPhaseCallback,
} from "./types.js";
import {
  buildPhasePrompt,
  buildForceDonePrompt,
  buildValidationErrorMessage,
  extractToolCalls,
  extractDoneCall,
  hasToolCallsWithDone,
  diffState,
} from "./protocol.js";
import { doneTool, executeAgentTool, unknownToolResult } from "./tools.js";
import { MetricsAccumulator } from "./metrics.js";

const MAX_VALIDATION_RETRIES = 2;

// ---------------------------------------------------------------------------
// LLM caller abstraction (for testability)
// ---------------------------------------------------------------------------

/**
 * Abstraction over the LLM call. In production, wraps streamSimple.
 * In tests, can be replaced with a mock.
 */
export interface LLMCaller {
  /**
   * Make an LLM call. Returns the final AssistantMessage and optionally
   * pipes streaming events.
   */
  call(
    model: Model<any>,
    context: Context,
    options?: SimpleStreamOptions,
    onStreamEvent?: (event: AssistantMessageEvent) => void,
  ): Promise<AssistantMessage>;
}

/** Default LLM caller using streamSimple. */
export const defaultLLMCaller: LLMCaller = {
  async call(model, context, options, onStreamEvent) {
    const stream = streamSimple(model, context, options);

    if (onStreamEvent) {
      pipeStreamEvents(stream, onStreamEvent);
    }

    return stream.result();
  },
};

/** LLM caller using completeSimple (no streaming). Used for force-done calls. */
export const simpleLLMCaller: LLMCaller = {
  async call(model, context, options) {
    return completeSimple(model, context, options);
  },
};

export interface PhaseRunnerOptions {
  model: Model<any>;
  cachedPrefix: string;
  phase: Phase;
  phaseIndex: number;
  totalPhases: number;
  state: State;
  config: ExecutorConfig;
  sessionId: string;
  /** Cumulative cost from previous phases (for cost limit). */
  priorCost: number;
  /** Override LLM caller (for testing). */
  llmCaller?: LLMCaller;
}

/**
 * Run a single phase. Returns when done() is called or budget is exceeded.
 */
export async function runPhase(opts: PhaseRunnerOptions): Promise<PhaseResult> {
  const { model, cachedPrefix, phase, phaseIndex, totalPhases, config, sessionId } = opts;
  const llm = opts.llmCaller ?? defaultLLMCaller;
  let state = opts.state;
  const onPhase = config.onPhase;
  const phaseBudget = config.phaseBudget ?? 30_000;
  const maxRounds = config.maxPhaseRounds ?? 15;

  // Resolve phase tools from registry
  const phaseTools: Array<{ tool: Tool; agentTool: any }> = [];
  for (const name of phase.tools) {
    const agentTool = config.tools[name];
    if (!agentTool) {
      throw new Error(`Unknown tool "${name}" in phase ${phaseIndex + 1} (${phase.description}). Available: ${Object.keys(config.tools).join(", ")}`);
    }
    phaseTools.push({ tool: agentTool as Tool, agentTool });
  }
  const allToolDefs: Tool[] = [...phaseTools.map((t) => t.tool), doneTool];

  // Initialize conversation
  const messages: Message[] = [
    {
      role: "user",
      content: buildPhasePrompt(state, phase, phaseIndex, totalPhases),
      timestamp: Date.now(),
    },
  ];

  const metrics = new MetricsAccumulator(phaseIndex);

  emitEvent(onPhase, {
    type: "phase_start",
    phaseIndex,
    phase,
  });

  let validationRetries = 0;

  for (let round = 1; round <= maxRounds; round++) {
    // Check abort
    if (config.signal?.aborted) {
      return makeResult("error", state, "Aborted", metrics, opts.state, { error: "Aborted by signal" });
    }

    // Check cumulative cost limit before making a call
    const maxCost = config.maxCostUsd ?? 2.0;
    if (opts.priorCost + metrics.getCumulativeCost() >= maxCost) {
      return makeResult("phase_budget", state, "Cost limit reached", metrics, opts.state);
    }

    // Budget warning — appended to system prompt for this call only
    const overBudgetThreshold = metrics.getCumulativeTokens() > phaseBudget * 0.8;
    const budgetNote = overBudgetThreshold
      ? "\n\nApproaching phase budget. Wrap up and call done()."
      : "";

    emitEvent(onPhase, { type: "round_start", phaseIndex, phase, round });

    // Make LLM call (streaming when using default caller)
    const response: AssistantMessage = await llm.call(
      model,
      {
        systemPrompt: cachedPrefix + budgetNote,
        messages,
        tools: allToolDefs,
      },
      { sessionId, signal: config.signal },
      onPhase
        ? (event) => emitEvent(onPhase, { type: "stream_event", phaseIndex, phase, streamEvent: event })
        : undefined,
    );
    metrics.addResponse(response);
    messages.push(response);

    // Check for done() call
    const doneCall = extractDoneCall(response);

    if (doneCall) {
      // Warn if done() was called alongside other tools
      if (hasToolCallsWithDone(response)) {
        // Execute co-occurring tools (results discarded per spec)
        const otherCalls = extractToolCalls(response).filter((tc) => tc.name !== "done");
        await executeToolCalls(otherCalls, phaseTools, config.signal);
        // Log warning via event
        emitEvent(onPhase, {
          type: "force_done",
          phaseIndex,
          phase,
          round,
          summary: `Warning: done() called alongside ${otherCalls.length} other tool(s). Tool results discarded.`,
        });
      }

      // Validate state if schema provided
      if (config.stateSchema) {
        const validation = config.stateSchema.safeParse(doneCall.state);
        if (!validation.success) {
          validationRetries++;
          const errors = validation.error?.issues ?? [];
          const errorMsgs = errors.map((e) => ({
            path: e.path,
            message: e.message,
          }));

          emitEvent(onPhase, {
            type: "state_validation_error",
            phaseIndex,
            phase,
            round,
            validationErrors: errorMsgs.map((e) => `${e.path.join(".")}: ${e.message}`),
          });

          if (validationRetries > MAX_VALIDATION_RETRIES) {
            return makeResult("error", doneCall.state, doneCall.summary, metrics, opts.state, {
              error: `State validation failed after ${MAX_VALIDATION_RETRIES} retries`,
            });
          }

          // Return done() tool result with validation error, let LLM retry
          messages.push({
            role: "toolResult",
            toolCallId: extractToolCalls(response).find((tc) => tc.name === "done")!.id,
            toolName: "done",
            content: [{ type: "text", text: buildValidationErrorMessage(errorMsgs) }],
            isError: true,
            timestamp: Date.now(),
          });
          continue;
        }
      }

      // Success — phase complete
      return makeResult("completed", doneCall.state, doneCall.summary, metrics, opts.state, {
        result: doneCall.result,
      });
    }

    // No done() — execute tool calls
    const toolCalls = extractToolCalls(response);
    if (toolCalls.length === 0) {
      // No tool calls and no done() — LLM just produced text.
      // This shouldn't happen often. If stopReason is "stop", the LLM is done talking.
      // Push a nudge to call done().
      if (response.stopReason === "stop") {
        messages.push({
          role: "user",
          content: "You must call done() when the phase is complete. If you're finished, call done() now with your state and summary.",
          timestamp: Date.now(),
        });
      }
      continue;
    }

    // Execute tools
    const results = await executeToolCalls(toolCalls, phaseTools, config.signal, onPhase, phaseIndex, phase);
    messages.push(...results);

    // Hard budget check — force done
    if (metrics.getCumulativeTokens() >= phaseBudget || round >= maxRounds) {
      emitEvent(onPhase, { type: "force_done", phaseIndex, phase, round });
      return await forceDone(model, cachedPrefix, state, sessionId, metrics, opts.state, config.signal, llm);
    }
  }

  // Fell through max rounds
  emitEvent(onPhase, { type: "force_done", phaseIndex, phase, round: maxRounds });
  return await forceDone(model, cachedPrefix, state, sessionId, metrics, opts.state, config.signal, llm);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function executeToolCalls(
  toolCalls: ToolCall[],
  phaseTools: Array<{ tool: Tool; agentTool: any }>,
  signal?: AbortSignal,
  onPhase?: OnPhaseCallback,
  phaseIndex?: number,
  phase?: Phase,
): Promise<Message[]> {
  const results = await Promise.all(
    toolCalls.map(async (tc) => {
      const entry = phaseTools.find((t) => t.tool.name === tc.name);
      if (!entry) {
        return unknownToolResult(tc, `Tool "${tc.name}" is not available in this phase.`);
      }

      if (onPhase && phaseIndex !== undefined && phase) {
        emitEvent(onPhase, { type: "tool_execute_start", phaseIndex, phase, toolName: tc.name, toolCallId: tc.id });
      }

      const result = await executeAgentTool(entry.agentTool, tc, signal);

      if (onPhase && phaseIndex !== undefined && phase) {
        emitEvent(onPhase, { type: "tool_execute_end", phaseIndex, phase, toolName: tc.name, toolCallId: tc.id });
      }

      return result;
    }),
  );
  return results;
}

async function forceDone(
  model: Model<any>,
  cachedPrefix: string,
  currentState: State,
  sessionId: string,
  metrics: MetricsAccumulator,
  prevState: State,
  signal?: AbortSignal,
  llm?: LLMCaller,
): Promise<PhaseResult> {
  try {
    const caller = llm ?? simpleLLMCaller;
    const response = await caller.call(
      model,
      {
        systemPrompt: cachedPrefix,
        messages: [
          {
            role: "user",
            content: buildForceDonePrompt(currentState),
            timestamp: Date.now(),
          },
        ],
        tools: [doneTool],
      },
      { sessionId, signal },
    );
    metrics.addResponse(response);

    const doneCall = extractDoneCall(response);
    if (doneCall) {
      return makeResult("phase_budget", doneCall.state, doneCall.summary, metrics, prevState);
    }
  } catch {
    // Force-done call failed, use current state
  }

  return makeResult("phase_budget", currentState, "Phase budget exceeded — forced done", metrics, prevState);
}

function makeResult(
  status: PhaseResult["status"],
  state: State,
  summary: string,
  metrics: MetricsAccumulator,
  prevState: State,
  extra?: { result?: Record<string, unknown>; error?: string },
): PhaseResult {
  return {
    status,
    state,
    summary,
    result: extra?.result,
    metrics: metrics.finalize(),
    stateDiff: diffState(prevState, state),
    error: extra?.error,
  };
}

function emitEvent(onPhase: OnPhaseCallback | undefined, event: Partial<PhaseEvent> & { type: PhaseEvent["type"]; phaseIndex: number; phase: Phase }): void {
  if (onPhase) {
    try {
      onPhase(event as PhaseEvent);
    } catch {
      // Don't let callback errors break the executor
    }
  }
}

/**
 * Pipe AssistantMessageEventStream events to the onPhase callback.
 * This runs as a fire-and-forget async loop — it doesn't block the main flow.
 */
function pipeStreamEvents(
  stream: AsyncIterable<any>,
  onPhase: OnPhaseCallback,
  phaseIndex: number,
  phase: Phase,
): void {
  (async () => {
    try {
      for await (const event of stream) {
        emitEvent(onPhase, {
          type: "stream_event",
          phaseIndex,
          phase,
          streamEvent: event,
        });
      }
    } catch {
      // Stream exhausted or errored — expected
    }
  })();
}
