/**
 * pi-exec phase runner — executes a single phase as a bounded conversation.
 *
 * The phase conversation grows within bounds (phaseBudget + maxPhaseRounds),
 * then gets discarded. Only the state from done() carries forward.
 *
 * Follows pi-agent-core's agent-loop pattern:
 * - Stream assistant response
 * - Extract tool calls
 * - Validate arguments, execute tools, collect results
 * - Append results, loop
 */

import { streamSimple } from "@mariozechner/pi-ai";
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
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type {
  Phase,
  State,
  PhaseResult,
  PhaseEvent,
  ExecutorConfig,
  OnPhaseCallback,
} from "./types.js";
import {
  buildPhasePrompt,
  buildForceDonePrompt,
  buildValidationErrorMessage,
  extractToolCalls,
  extractDoneCall,
  diffState,
} from "./protocol.js";
import { doneTool, executeAgentTool, createErrorResult } from "./tools.js";
import { MetricsAccumulator } from "./metrics.js";

const MAX_VALIDATION_RETRIES = 2;

// ---------------------------------------------------------------------------
// Stream function abstraction (matches pi-agent-core's StreamFn pattern)
// ---------------------------------------------------------------------------

/**
 * Abstraction over the LLM call. Follows pi-agent-core's StreamFn concept
 * but returns the final AssistantMessage directly (since we don't need
 * the full event stream machinery of the agent loop).
 *
 * In production, wraps streamSimple. In tests, replaced with a mock.
 */
export interface LLMCaller {
  call(
    model: Model<any>,
    context: Context,
    options?: SimpleStreamOptions,
    onStreamEvent?: (event: AssistantMessageEvent) => void,
  ): Promise<AssistantMessage>;
}

/** Default LLM caller using streamSimple with optional event forwarding. */
export const defaultLLMCaller: LLMCaller = {
  async call(model, context, options, onStreamEvent) {
    const stream = streamSimple(model, context, options);

    // Pipe stream events if a listener is provided (fire-and-forget)
    if (onStreamEvent) {
      (async () => {
        try {
          for await (const event of stream) {
            onStreamEvent(event);
          }
        } catch {
          // Stream exhausted or errored — expected when .result() resolves first
        }
      })();
    }

    return stream.result();
  },
};

// ---------------------------------------------------------------------------
// Phase runner options
// ---------------------------------------------------------------------------

export interface PhaseRunnerOptions {
  model: Model<any>;
  cachedPrefix: string;
  phase: Phase;
  phaseIndex: number;
  totalPhases: number;
  state: State;
  config: ExecutorConfig;
  sessionId: string;
  /** Cumulative cost from previous phases (for cost limit checks). */
  priorCost: number;
  /** Override LLM caller (for testing). */
  llmCaller?: LLMCaller;
  /** Override the initial user message (used by gates). */
  initialPrompt?: string;
}

// ---------------------------------------------------------------------------
// Phase runner
// ---------------------------------------------------------------------------

/**
 * Run a single phase. Returns when done() is called or budget is exceeded.
 */
export async function runPhase(opts: PhaseRunnerOptions): Promise<PhaseResult> {
  const { model, cachedPrefix, phase, phaseIndex, totalPhases, config, sessionId } = opts;
  const llm = opts.llmCaller ?? defaultLLMCaller;
  const onPhase = config.onPhase;
  const phaseBudget = config.phaseBudget ?? 30_000;
  const maxRounds = config.maxPhaseRounds ?? 15;

  // Resolve phase tools from registry
  const phaseTools = resolvePhaseTools(phase, config, phaseIndex);
  const allToolDefs: Tool[] = [...phaseTools.map((t) => t as Tool), doneTool];

  // Initialize conversation with the phase prompt (or custom initial prompt for gates)
  const messages: Message[] = [
    {
      role: "user",
      content: opts.initialPrompt ?? buildPhasePrompt(opts.state, phase, phaseIndex, totalPhases),
      timestamp: Date.now(),
    },
  ];

  const metrics = new MetricsAccumulator(phaseIndex);
  let validationRetries = 0;

  emit(onPhase, { type: "phase_start", phaseIndex, phase });

  for (let round = 1; round <= maxRounds; round++) {
    if (config.signal?.aborted) {
      return finalize("error", opts.state, "Aborted", metrics, opts.state, { error: "Aborted by signal" });
    }

    // Check cost limit before making a call
    const maxCost = config.maxCostUsd ?? 2.0;
    if (opts.priorCost + metrics.getCumulativeCost() >= maxCost) {
      return finalize("phase_budget", opts.state, "Cost limit reached", metrics, opts.state);
    }

    // Budget warning — injected as a user message to avoid breaking prompt cache.
    // The cached prefix (system prompt) must stay stable across all calls.
    const overBudget = metrics.getCumulativeTokens() > phaseBudget * 0.8;
    if (overBudget) {
      emit(onPhase, { type: "budget_warning", phaseIndex, phase, round });
      messages.push({
        role: "user",
        content: "⚠️ Approaching phase budget. Wrap up and call done() with your current state.",
        timestamp: Date.now(),
      });
    }

    emit(onPhase, { type: "round_start", phaseIndex, phase, round });

    // Make LLM call — system prompt is always the stable cachedPrefix (for caching)
    const response = await llm.call(
      model,
      { systemPrompt: cachedPrefix, messages, tools: allToolDefs },
      { sessionId, signal: config.signal, apiKey: config.apiKey },
      onPhase
        ? (event) => emit(onPhase, { type: "stream_event", phaseIndex, phase, streamEvent: event })
        : undefined,
    );
    metrics.addResponse(response);
    messages.push(response);

    // Check for done() call
    const doneCall = extractDoneCall(response);
    if (doneCall) {
      const allCalls = extractToolCalls(response);
      const otherCalls = allCalls.filter((tc) => tc.name !== "done");
      const hasConcurrentTools = otherCalls.length > 0;

      // Execute co-occurring tool calls (results used only for message ordering)
      let otherResults: Message[] = [];
      if (hasConcurrentTools) {
        otherResults = await runToolCalls(otherCalls, phaseTools, config.signal);
        emit(onPhase, {
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
          const issues = validation.error?.issues ?? [];
          const errorMsgs = issues.map((e) => ({ path: e.path, message: e.message }));

          emit(onPhase, {
            type: "state_validation_error",
            phaseIndex,
            phase,
            round,
            validationErrors: errorMsgs.map((e) => `${e.path.join(".")}: ${e.message}`),
          });

          if (validationRetries > MAX_VALIDATION_RETRIES) {
            return finalize("error", doneCall.state, doneCall.summary, metrics, opts.state, {
              error: `State validation failed after ${MAX_VALIDATION_RETRIES} retries`,
            });
          }

          // Push tool results for ALL tool calls in this response to maintain
          // valid message ordering. OpenAI requires a toolResult for every
          // toolCall in an assistant message.
          if (hasConcurrentTools) {
            messages.push(...otherResults);
          }
          const doneToolCall = allCalls.find((tc) => tc.name === "done")!;
          messages.push({
            role: "toolResult",
            toolCallId: doneToolCall.id,
            toolName: "done",
            content: [{ type: "text", text: buildValidationErrorMessage(errorMsgs) }],
            isError: true,
            timestamp: Date.now(),
          });
          continue;
        }
      }

      return finalize("completed", doneCall.state, doneCall.summary, metrics, opts.state, {
        result: doneCall.result,
      });
    }

    // No valid done() — execute tool calls (including malformed done() calls)
    const toolCalls = extractToolCalls(response);
    if (toolCalls.length === 0 && response.stopReason === "stop") {
      // LLM produced text only. Nudge it to call done().
      messages.push({
        role: "user",
        content: "You must call done() when the phase is complete. If you're finished, call done() now with your state and summary.",
        timestamp: Date.now(),
      });
      continue;
    }

    if (toolCalls.length > 0) {
      const results = await runToolCalls(toolCalls, phaseTools, config.signal, onPhase, phaseIndex, phase);
      messages.push(...results);
    }

    // Hard budget check
    if (metrics.getCumulativeTokens() >= phaseBudget || round >= maxRounds) {
      emit(onPhase, { type: "force_done", phaseIndex, phase, round });
      return await attemptForceDone(model, cachedPrefix, opts.state, sessionId, metrics, opts.state, config.signal, llm, config.apiKey);
    }
  }

  // Fell through max rounds
  emit(onPhase, { type: "force_done", phaseIndex, phase, round: maxRounds });
  return await attemptForceDone(model, cachedPrefix, opts.state, sessionId, metrics, opts.state, config.signal, llm, config.apiKey);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve phase tools from the registry. Throws if any tool is missing.
 */
function resolvePhaseTools(
  phase: Phase,
  config: ExecutorConfig,
  phaseIndex: number,
): AgentTool<any, any>[] {
  return phase.tools.map((name) => {
    const tool = config.tools[name];
    if (!tool) {
      throw new Error(
        `Unknown tool "${name}" in phase ${phaseIndex + 1} (${phase.description}). ` +
        `Available: ${Object.keys(config.tools).join(", ")}`,
      );
    }
    return tool;
  });
}

/**
 * Execute tool calls and produce ToolResultMessages.
 * Follows pi-agent-core's parallel execution pattern.
 */
async function runToolCalls(
  toolCalls: ToolCall[],
  phaseTools: AgentTool<any, any>[],
  signal?: AbortSignal,
  onPhase?: OnPhaseCallback,
  phaseIndex?: number,
  phase?: Phase,
): Promise<Message[]> {
  return Promise.all(
    toolCalls.map(async (tc) => {
      // Handle malformed done() calls (extractDoneCall returned null but tool call exists)
      if (tc.name === "done") {
        return createErrorResult(tc,
          'Invalid done() call. The "state" argument must be a non-null object and "summary" must be a string. ' +
          "Call done() again with valid arguments.",
        );
      }

      const tool = phaseTools.find((t) => t.name === tc.name);
      if (!tool) {
        return createErrorResult(tc, `Tool "${tc.name}" is not available in this phase.`);
      }

      if (onPhase && phaseIndex !== undefined && phase) {
        emit(onPhase, { type: "tool_execute_start", phaseIndex, phase, toolName: tc.name, toolCallId: tc.id });
      }

      const result = await executeAgentTool(tool, tc, signal);

      if (onPhase && phaseIndex !== undefined && phase) {
        emit(onPhase, { type: "tool_execute_end", phaseIndex, phase, toolName: tc.name, toolCallId: tc.id });
      }

      return result;
    }),
  );
}

/**
 * Attempt a force-done: make a single LLM call asking for done() only.
 * If it fails or doesn't produce done(), fall back to current state.
 */
async function attemptForceDone(
  model: Model<any>,
  cachedPrefix: string,
  currentState: State,
  sessionId: string,
  metrics: MetricsAccumulator,
  prevState: State,
  signal?: AbortSignal,
  llm?: LLMCaller,
  apiKey?: string,
): Promise<PhaseResult> {
  try {
    const caller = llm ?? defaultLLMCaller;
    const response = await caller.call(
      model,
      {
        systemPrompt: cachedPrefix,
        messages: [{
          role: "user",
          content: buildForceDonePrompt(currentState),
          timestamp: Date.now(),
        }],
        tools: [doneTool],
      },
      { sessionId, signal, apiKey },
    );
    metrics.addResponse(response);

    const doneCall = extractDoneCall(response);
    if (doneCall) {
      return finalize("phase_budget", doneCall.state, doneCall.summary, metrics, prevState);
    }
  } catch {
    // Force-done call failed — fall through to use current state
  }

  return finalize("phase_budget", currentState, "Phase budget exceeded — forced done", metrics, prevState);
}

/**
 * Build a PhaseResult with metrics and state diff.
 */
function finalize(
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

/**
 * Emit a phase event. Swallows callback errors to prevent breaking the executor.
 */
function emit(
  onPhase: OnPhaseCallback | undefined,
  event: Partial<PhaseEvent> & { type: PhaseEvent["type"]; phaseIndex: number; phase: Phase },
): void {
  if (!onPhase) return;
  try {
    onPhase(event as PhaseEvent);
  } catch {
    // Don't let callback errors break the executor
  }
}
