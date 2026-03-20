/**
 * pi-exec — Plan-driven execution runtime for Pi.
 *
 * @example
 * ```typescript
 * import { createExecutor } from "pi-exec";
 * import { getModel } from "@mariozechner/pi-ai";
 * import { createReadTool, createEditTool, createBashTool } from "@mariozechner/pi-coding-agent";
 *
 * const model = getModel("openai-codex", "gpt-5.4");
 * const cwd = process.cwd();
 *
 * const result = await createExecutor({
 *   model,
 *   tools: {
 *     read: createReadTool(cwd),
 *     edit: createEditTool(cwd),
 *     bash: createBashTool(cwd),
 *   },
 * }).run({
 *   plan: [
 *     { description: "Read and analyze the code", tools: ["read"] },
 *     { description: "Apply the fix", tools: ["read", "edit"] },
 *     { description: "Run tests", tools: ["bash"] },
 *   ],
 *   initialState: {},
 *   onPhase: (event) => console.log(event.type, event.summary),
 * });
 *
 * console.log(result.status, result.state, result.metrics);
 * ```
 */

export { createExecutor } from "./executor.js";
export type { Executor } from "./executor.js";

export type {
  // Plan & Phase
  Phase,
  Plan,
  State,
  StateDiff,
  ToolRegistry,
  // Events
  PhaseEvent,
  PhaseEventType,
  OnPhaseCallback,
  // Metrics
  PhaseMetrics,
  RunMetrics,
  // Results
  RunStatus,
  RunResult,
  PhaseResult,
  // Config
  ExecutorConfig,
  RunOptions,
  RunWithPlan,
  RunWithTask,
} from "./types.js";

export { doneTool } from "./tools.js";
export type { DoneCallArgs } from "./tools.js";

// Re-export protocol utilities for advanced usage
export {
  buildCachedPrefix,
  buildPhasePrompt,
  extractDoneCall,
  extractToolCalls,
  diffState,
  validatePlanFromState,
} from "./protocol.js";

export { aggregateMetrics, MetricsAccumulator } from "./metrics.js";

// Testing utilities
export type { LLMCaller } from "./phase.js";
