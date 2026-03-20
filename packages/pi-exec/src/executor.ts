/**
 * pi-exec executor — the top-level plan loop.
 *
 * Iterates through phases, passing state between them, tracking metrics,
 * and handling Phase 0 plan generation when no plan is provided.
 */

import { randomUUID } from "node:crypto";
import type { ExecutorConfig, Plan, RunOptions, RunResult, State, PhaseMetrics, Phase } from "./types.js";
import { isRunWithPlan } from "./types.js";
import { buildCachedPrefix, buildGatePrompt, validatePlanFromState } from "./protocol.js";
import { runPhase, type LLMCaller } from "./phase.js";
import { aggregateMetrics } from "./metrics.js";

// ---------------------------------------------------------------------------
// Default system prompt
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM_PROMPT = `You are X, a task executor. You work through plans phase by phase.
Each phase has a specific goal and a set of tools available. Execute the current phase,
then call done() with your updated state and a summary of what you accomplished.`;

// ---------------------------------------------------------------------------
// Phase 0: Plan generation
// ---------------------------------------------------------------------------

const PLANNING_INSTRUCTIONS = `You are X, a task executor. Your job right now is to understand the task
and create an execution plan.

Explore the codebase as needed using the available tools. Then call done() with:
- state.plan: an array of phases, each with "description" (string) and "tools" (string[])
- state.context_gathered: any context from your exploration that subsequent phases will need
- summary: a description of your plan

Available tool names you can assign to phases: {tools}

Make phases focused and well-scoped. Each phase should have a clear deliverable.
Prefer fewer phases with broader scope over many tiny phases.`;

async function generatePlan(
  config: ExecutorConfig,
  task: string,
  planningTools: string[],
  initialState: State,
  sessionId: string,
  llmCaller?: LLMCaller,
): Promise<{ plan: Plan; state: State; metrics: PhaseMetrics }> {
  const availableToolNames = Object.keys(config.tools).join(", ");
  const planningPrompt = PLANNING_INSTRUCTIONS.replace("{tools}", availableToolNames);

  // Use caller-specified planning tools, or fall back to all tools.
  // Callers that want read-only planning should pass planningTools explicitly.
  const toolNames = planningTools.length > 0
    ? planningTools
    : Object.keys(config.tools);

  const phase0 = {
    description: `Understand the task and create an execution plan: ${task}`,
    tools: toolNames,
  };

  const result = await runPhase({
    model: config.model,
    cachedPrefix: planningPrompt,
    phase: phase0,
    phaseIndex: 0, // Phase 0 (planning) — indexed at 0 in metrics
    totalPhases: 1,
    state: { ...initialState, task },
    config,
    sessionId,
    priorCost: 0,
    llmCaller,
  });

  if (result.status === "error") {
    throw new Error(`Phase 0 (planning) failed: ${result.error || result.summary}`);
  }

  const plan = validatePlanFromState(result.state);

  // Carry context_gathered forward, drop the plan from state
  const { plan: _plan, ...carryState } = result.state;

  return { plan, state: carryState, metrics: result.metrics };
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface ExecutorOptions extends ExecutorConfig {
  /** Override LLM caller (for testing). */
  llmCaller?: LLMCaller;
}

export interface Executor {
  run(options: RunOptions): Promise<RunResult>;
}

/**
 * Create an executor instance.
 *
 * @example
 * ```typescript
 * const result = await createExecutor({
 *   model: getModel("openai-codex", "gpt-5.4"),
 *   tools: { read: createReadTool(cwd), edit: createEditTool(cwd) },
 * }).run({
 *   plan: [
 *     { description: "Read code", tools: ["read"] },
 *     { description: "Apply fix", tools: ["read", "edit"] },
 *   ],
 * });
 * ```
 */
export function createExecutor(options: ExecutorOptions): Executor {
  const { llmCaller, ...config } = options;
  const model = config.model;
  const systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  return {
    async run(runOptions: RunOptions): Promise<RunResult> {
      const sessionId = `pi-exec-${randomUUID()}`;
      const allPhaseMetrics: PhaseMetrics[] = [];
      const phaseSummaries: string[] = [];
      let cumulativeCost = 0;

      let plan: Plan;
      let state: State;

      if (isRunWithPlan(runOptions)) {
        plan = runOptions.plan;
        state = runOptions.initialState ?? {};
      } else {
        const phase0 = await generatePlan(
          config,
          runOptions.task,
          runOptions.planningTools ?? [],
          runOptions.initialState ?? {},
          sessionId,
          llmCaller,
        );
        plan = phase0.plan;
        state = phase0.state;
        allPhaseMetrics.push(phase0.metrics);
        cumulativeCost += phase0.metrics.cost;
        phaseSummaries.push(`Phase 0 (planning): Generated ${plan.length}-phase plan`);
      }

      // Validate all phase tool references before starting execution
      for (let i = 0; i < plan.length; i++) {
        for (const toolName of plan[i].tools) {
          if (!config.tools[toolName]) {
            return {
              status: "error",
              state,
              metrics: aggregateMetrics(allPhaseMetrics),
              phaseSummaries,
              error: `Phase ${i + 1} references unknown tool "${toolName}". Available: ${Object.keys(config.tools).join(", ")}`,
            };
          }
        }
      }

      // Empty plan — nothing to execute
      if (plan.length === 0) {
        return {
          status: "completed",
          state,
          metrics: aggregateMetrics(allPhaseMetrics),
          phaseSummaries,
        };
      }

      // Build cached prefix (stable across all execution phases)
      const cachedPrefix = buildCachedPrefix(systemPrompt, plan);

      for (let i = 0; i < plan.length; i++) {
        const phase = plan[i];
        // maxRetries is the number of times the work phase can be retried after a gate failure.
        // Total gate attempts = maxRetries + 1 (initial + retries).
        const maxRetries = phase.maxRetries ?? 2;

        // Check cost limit before starting a new phase
        const maxCost = config.maxCostUsd ?? 2.0;
        if (cumulativeCost >= maxCost) {
          return {
            status: "max_cost",
            state,
            metrics: aggregateMetrics(allPhaseMetrics),
            phaseSummaries,
            error: `Cost limit ($${maxCost.toFixed(2)}) reached after phase ${i}. Cumulative: $${cumulativeCost.toFixed(4)}`,
          };
        }

        if (config.signal?.aborted) {
          return {
            status: "error",
            state,
            metrics: aggregateMetrics(allPhaseMetrics),
            phaseSummaries,
            error: "Aborted by signal",
          };
        }

        // Run work phase with gate retry loop
        let lastResult = await runWorkPhase(
          model, cachedPrefix, phase, i, plan.length, state,
          config, sessionId, cumulativeCost, llmCaller,
        );

        allPhaseMetrics.push(lastResult.metrics);
        cumulativeCost += lastResult.metrics.cost;

        // Gate check: if phase has a gate and work succeeded, verify it.
        // Runs the gate, and if it fails, retries the work phase up to maxRetries times.
        if (phase.gate && lastResult.status === "completed") {
          for (let retry = 0; retry <= maxRetries; retry++) {
            // Cost limit check before each gate/retry iteration
            const maxCost = config.maxCostUsd ?? 2.0;
            if (cumulativeCost >= maxCost) {
              return {
                status: "max_cost",
                state: lastResult.state,
                metrics: aggregateMetrics(allPhaseMetrics),
                phaseSummaries,
                error: `Cost limit ($${maxCost.toFixed(2)}) reached during gate retry for phase ${i + 1}`,
              };
            }

            const gateResult = await runGate(
              model, cachedPrefix, phase, i, lastResult.state,
              config, sessionId, cumulativeCost, llmCaller,
            );

            allPhaseMetrics.push(gateResult.metrics);
            cumulativeCost += gateResult.metrics.cost;

            if (gateResult.passed) {
              emitSafe(config.onPhase, {
                type: "gate_pass",
                phaseIndex: i,
                phase,
                summary: gateResult.summary,
              });
              break;
            }

            // Gate failed
            emitSafe(config.onPhase, {
              type: "gate_fail",
              phaseIndex: i,
              phase,
              gateIssues: gateResult.issues,
              gateAttempt: retry + 1,
              summary: `Gate failed (attempt ${retry + 1}/${maxRetries + 1}): ${gateResult.issues.join("; ")}`,
            });

            // No more retries left
            if (retry >= maxRetries) {
              phaseSummaries.push(
                `Phase ${i + 1}: Gate failed after ${maxRetries} ${maxRetries === 1 ? "retry" : "retries"}: ${gateResult.issues.join("; ")}`,
              );
              return {
                status: "error",
                state: lastResult.state,
                metrics: aggregateMetrics(allPhaseMetrics),
                phaseSummaries,
                error: `Phase ${i + 1} gate failed after ${maxRetries} ${maxRetries === 1 ? "retry" : "retries"}: ${gateResult.issues.join("; ")}`,
              };
            }

            // Re-run work phase with gate failure context injected into state
            const retryState = {
              ...state,
              _gate_failure: {
                attempt: retry + 1,
                issues: gateResult.issues,
                instruction: `Previous attempt failed verification. Issues: ${gateResult.issues.join("; ")}. Fix these issues.`,
              },
            };

            lastResult = await runWorkPhase(
              model, cachedPrefix, phase, i, plan.length, retryState,
              config, sessionId, cumulativeCost, llmCaller,
            );

            allPhaseMetrics.push(lastResult.metrics);
            cumulativeCost += lastResult.metrics.cost;

            if (lastResult.status !== "completed") {
              // Work phase itself failed on retry — don't silently continue
              phaseSummaries.push(
                `Phase ${i + 1}: Work phase failed on gate retry: ${lastResult.error || lastResult.status}`,
              );
              return {
                status: lastResult.status === "phase_budget" ? "phase_budget" : "error",
                state: lastResult.state,
                metrics: aggregateMetrics(allPhaseMetrics),
                phaseSummaries,
                error: lastResult.error || `Phase ${i + 1} failed during gate retry (${lastResult.status})`,
              };
            }
          }
        }

        phaseSummaries.push(`Phase ${i + 1}: ${lastResult.summary}`);

        // Emit phase_end event
        emitSafe(config.onPhase, {
          type: "phase_end",
          phaseIndex: i,
          phase,
          summary: lastResult.summary,
          state: lastResult.state,
          stateDiff: lastResult.stateDiff,
          metrics: lastResult.metrics,
        });

        state = lastResult.state;

        // Clean up gate failure context from state before passing forward
        delete state._gate_failure;

        if (lastResult.status === "error") {
          return {
            status: "error",
            state,
            metrics: aggregateMetrics(allPhaseMetrics),
            phaseSummaries,
            error: lastResult.error || `Phase ${i + 1} failed`,
          };
        }

        if (lastResult.status === "phase_budget" && i === plan.length - 1) {
          return {
            status: "phase_budget",
            state,
            output: lastResult.result,
            metrics: aggregateMetrics(allPhaseMetrics),
            phaseSummaries,
          };
        }

        // Last phase — return completed
        if (i === plan.length - 1) {
          return {
            status: "completed",
            state,
            output: lastResult.result,
            metrics: aggregateMetrics(allPhaseMetrics),
            phaseSummaries,
          };
        }
      }

      // Should not reach here
      return {
        status: "completed",
        state,
        metrics: aggregateMetrics(allPhaseMetrics),
        phaseSummaries,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Run a work phase. Thin wrapper over runPhase for readability. */
async function runWorkPhase(
  model: ExecutorConfig["model"],
  cachedPrefix: string,
  phase: Phase,
  phaseIndex: number,
  totalPhases: number,
  state: State,
  config: ExecutorConfig,
  sessionId: string,
  priorCost: number,
  llmCaller?: LLMCaller,
) {
  return runPhase({
    model,
    cachedPrefix,
    phase,
    phaseIndex,
    totalPhases,
    state,
    config,
    sessionId,
    priorCost,
    llmCaller,
  });
}

/** Gate result from a gate sub-phase. */
interface GateResult {
  passed: boolean;
  issues: string[];
  summary: string;
  metrics: PhaseMetrics;
}

/**
 * Tool name patterns allowed in gate verification phases.
 * Gates get read-only tools by default — they verify, not modify.
 * If no matching tools are found, falls back to all phase tools with a warning.
 */
const GATE_TOOL_PATTERNS = ["read", "grep", "find", "ls"];

/**
 * Run a gate sub-phase to verify a work phase's output.
 *
 * The gate verifier gets read-only tools and checks the verification criteria.
 * Returns passed/failed with issues.
 */
async function runGate(
  model: ExecutorConfig["model"],
  cachedPrefix: string,
  phase: Phase,
  phaseIndex: number,
  workState: State,
  config: ExecutorConfig,
  sessionId: string,
  priorCost: number,
  llmCaller?: LLMCaller,
): Promise<GateResult> {
  // Gate tools: read-only subset of the phase's tools.
  // Falls back to all phase tools if no read-only tools match (with warning).
  const gateToolNames = phase.tools.filter((name) => {
    const lower = name.toLowerCase();
    return GATE_TOOL_PATTERNS.some((pattern) => lower.includes(pattern));
  });
  const toolNames = gateToolNames.length > 0 ? gateToolNames : phase.tools;
  if (gateToolNames.length === 0 && phase.tools.length > 0) {
    emitSafe(config.onPhase, {
      type: "gate_start",
      phaseIndex,
      phase,
      summary: `Warning: no read-only tools found for gate. Using all phase tools: ${phase.tools.join(", ")}`,
    });
  }

  const gatePhase: Phase = {
    description: `Verify: ${phase.gate}`,
    tools: toolNames,
  };

  emitSafe(config.onPhase, {
    type: "gate_start",
    phaseIndex,
    phase,
    summary: `Gate: ${phase.gate}`,
  });

  const result = await runPhase({
    model,
    cachedPrefix,
    phase: gatePhase,
    phaseIndex,
    totalPhases: 1,
    state: workState,
    initialPrompt: buildGatePrompt(workState, phase.gate!, phase.description),
    config: {
      ...config,
      // Gate gets a smaller budget — it's just verification
      phaseBudget: Math.min(config.phaseBudget ?? 30_000, 15_000),
      maxPhaseRounds: Math.min(config.maxPhaseRounds ?? 15, 8),
    },
    sessionId,
    priorCost,
    llmCaller,
  });

  // Extract gate verdict from done()'s result field
  const passed = result.result?.passed === true;
  const issues: string[] = Array.isArray(result.result?.issues)
    ? (result.result.issues as string[])
    : [];

  // If gate phase errored or budget-exceeded, treat as failed
  if (result.status !== "completed") {
    return {
      passed: false,
      issues: [result.error || `Gate phase ${result.status}`],
      summary: result.summary,
      metrics: result.metrics,
    };
  }

  return {
    passed,
    issues: passed ? [] : (issues.length > 0 ? issues : [result.summary]),
    summary: result.summary,
    metrics: result.metrics,
  };
}

/**
 * Emit a phase event safely. Swallows callback errors.
 */
function emitSafe(
  onPhase: ExecutorConfig["onPhase"],
  event: Partial<import("./types.js").PhaseEvent> & { type: import("./types.js").PhaseEventType; phaseIndex: number; phase: Phase },
): void {
  if (!onPhase) return;
  try {
    onPhase(event as import("./types.js").PhaseEvent);
  } catch {
    // Don't let callback errors break the executor
  }
}
