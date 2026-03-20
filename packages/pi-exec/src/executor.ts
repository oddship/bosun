/**
 * pi-exec executor — the top-level plan loop.
 *
 * Iterates through phases, passing state between them, tracking metrics,
 * and handling Phase 0 plan generation.
 */

import { randomUUID } from "node:crypto";
import type { Model, Tool } from "@mariozechner/pi-ai";
import type {
  ExecutorConfig,
  Plan,
  RunOptions,
  RunResult,
  State,
  PhaseMetrics,
} from "./types.js";
import { isRunWithPlan } from "./types.js";
import { buildCachedPrefix, validatePlanFromState } from "./protocol.js";
import { runPhase, type LLMCaller } from "./phase.js";
import { aggregateMetrics } from "./metrics.js";
import { doneTool } from "./tools.js";

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

Available tool names you can assign to phases: ${"{tools}"}

Make phases focused and well-scoped. Each phase should have a clear deliverable.
Prefer fewer phases with broader scope over many tiny phases.`;

async function generatePlan(
  config: ExecutorConfig,
  task: string,
  planningTools: string[],
  initialState: State,
  sessionId: string,
): Promise<{ plan: Plan; state: State; metrics: PhaseMetrics }> {
  const availableToolNames = Object.keys(config.tools).join(", ");
  const planningPrompt = PLANNING_INSTRUCTIONS.replace("{tools}", availableToolNames);

  // Phase 0 uses planning tools (default: read-only)
  const phase0Tools = planningTools.length > 0
    ? planningTools
    : Object.keys(config.tools).filter((name) => {
        const lower = name.toLowerCase();
        return ["read", "grep", "find", "ls", "bash"].some((ro) => lower.includes(ro));
      });

  // If no read-only tools found, use all tools
  const toolNames = phase0Tools.length > 0 ? phase0Tools : Object.keys(config.tools);

  const phase0 = {
    description: `Understand the task and create an execution plan: ${task}`,
    tools: toolNames,
  };

  const result = await runPhase({
    model: config.model,
    cachedPrefix: planningPrompt,
    phase: phase0,
    phaseIndex: -1, // Phase 0 is special
    totalPhases: 1,
    state: { ...initialState, task },
    config,
    sessionId,
    priorCost: 0,
    llmCaller: config._llmCaller as LLMCaller | undefined,
  });

  if (result.status === "error") {
    throw new Error(`Phase 0 (planning) failed: ${result.error || result.summary}`);
  }

  const plan = validatePlanFromState(result.state);

  // Extract context_gathered for subsequent phases, remove plan from state
  const { plan: _plan, ...carryState } = result.state;

  return {
    plan,
    state: carryState,
    metrics: result.metrics,
  };
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface Executor {
  run(options: RunOptions): Promise<RunResult>;
}

/**
 * Create an executor instance with the given configuration.
 *
 * Usage:
 * ```typescript
 * const result = await createExecutor({ model, tools, ... }).run({ plan, initialState });
 * ```
 */
export function createExecutor(config: ExecutorConfig): Executor {
  const model = config.model;
  const systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  return {
    async run(options: RunOptions): Promise<RunResult> {
      const sessionId = `pi-exec-${randomUUID()}`;
      const allPhaseMetrics: PhaseMetrics[] = [];
      const phaseSummaries: string[] = [];
      let cumulativeCost = 0;

      let plan: Plan;
      let state: State;

      // Phase 0 or caller-provided plan
      if (isRunWithPlan(options)) {
        plan = options.plan;
        state = options.initialState ?? {};
      } else {
        const phase0 = await generatePlan(
          config,
          options.task,
          options.planningTools ?? [],
          options.initialState ?? {},
          sessionId,
        );
        plan = phase0.plan;
        state = phase0.state;
        allPhaseMetrics.push(phase0.metrics);
        cumulativeCost += phase0.metrics.cost;
        phaseSummaries.push(`Phase 0 (planning): Generated ${plan.length}-phase plan`);
      }

      // Validate all phase tools exist before starting
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

      // Build cached prefix (stable across all execution phases)
      const cachedPrefix = buildCachedPrefix(systemPrompt, plan);

      // Execute phases
      for (let i = 0; i < plan.length; i++) {
        const phase = plan[i];

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

        // Check abort
        if (config.signal?.aborted) {
          return {
            status: "error",
            state,
            metrics: aggregateMetrics(allPhaseMetrics),
            phaseSummaries,
            error: "Aborted by signal",
          };
        }

        const result = await runPhase({
          model,
          cachedPrefix,
          phase,
          phaseIndex: i,
          totalPhases: plan.length,
          state,
          config,
          sessionId,
          priorCost: cumulativeCost,
          llmCaller: config._llmCaller as LLMCaller | undefined,
        });

        allPhaseMetrics.push(result.metrics);
        cumulativeCost += result.metrics.cost;
        phaseSummaries.push(`Phase ${i + 1}: ${result.summary}`);

        // Emit phase_end event
        if (config.onPhase) {
          try {
            config.onPhase({
              type: "phase_end",
              phaseIndex: i,
              phase,
              summary: result.summary,
              state: result.state,
              stateDiff: result.stateDiff,
              metrics: result.metrics,
            });
          } catch {
            // Don't let callback errors break the executor
          }
        }

        // Update state
        state = result.state;

        // Check phase result status
        if (result.status === "error") {
          return {
            status: "error",
            state,
            metrics: aggregateMetrics(allPhaseMetrics),
            phaseSummaries,
            error: result.error || `Phase ${i + 1} failed`,
          };
        }

        if (result.status === "phase_budget") {
          // Phase budget exceeded but we got some state.
          // If this is the last phase, return as completed-ish.
          // Otherwise, continue with partial state.
          if (i === plan.length - 1) {
            return {
              status: "phase_budget",
              state,
              output: result.result,
              metrics: aggregateMetrics(allPhaseMetrics),
              phaseSummaries,
            };
          }
          // Continue to next phase with whatever state we got
        }

        // Last phase — extract output
        if (i === plan.length - 1) {
          return {
            status: "completed",
            state,
            output: result.result,
            metrics: aggregateMetrics(allPhaseMetrics),
            phaseSummaries,
          };
        }
      }

      // Should not reach here, but just in case
      return {
        status: "completed",
        state,
        metrics: aggregateMetrics(allPhaseMetrics),
        phaseSummaries,
      };
    },
  };
}
