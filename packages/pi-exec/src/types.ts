/**
 * pi-exec types — Plan, Phase, State, PhaseEvent, RunResult
 */

import type {
  Tool,
  Model,
  AssistantMessageEvent,
} from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";

// ---------------------------------------------------------------------------
// Plan & Phase
// ---------------------------------------------------------------------------

/** A single phase in an execution plan. */
export interface Phase {
  /** Human-readable description of what this phase does. */
  description: string;
  /** Tool names (keys into the tool registry) available in this phase. */
  tools: string[];
}

/** A complete execution plan — an ordered list of phases. */
export type Plan = Phase[];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Working state passed between phases. JSON-serializable. */
export type State = Record<string, unknown>;

/** Diff of state changes between phases (for debugging/logging). */
export interface StateDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

/**
 * Tool registry maps string keys to AgentTool instances.
 * Phases reference tools by key. The executor resolves them at runtime.
 */
export type ToolRegistry = Record<string, AgentTool<any, any>>;

// ---------------------------------------------------------------------------
// Phase Events (emitted via onPhase hook)
// ---------------------------------------------------------------------------

export type PhaseEventType =
  | "phase_start"
  | "phase_end"
  | "round_start"
  | "stream_event"
  | "tool_execute_start"
  | "tool_execute_end"
  | "budget_warning"
  | "force_done"
  | "state_validation_error";

export interface PhaseEvent {
  type: PhaseEventType;
  phaseIndex: number;
  phase: Phase;
  /** Current round within the phase (1-indexed). */
  round?: number;
  /** Streaming event from the LLM (when type === "stream_event"). */
  streamEvent?: AssistantMessageEvent;
  /** Tool name being executed (when type === "tool_execute_start/end"). */
  toolName?: string;
  /** Tool call ID (when type === "tool_execute_start/end"). */
  toolCallId?: string;
  /** Phase summary from done() (when type === "phase_end"). */
  summary?: string;
  /** State after this phase (when type === "phase_end"). */
  state?: State;
  /** State diff (when type === "phase_end"). */
  stateDiff?: StateDiff;
  /** Validation errors (when type === "state_validation_error"). */
  validationErrors?: string[];
  /** Phase metrics (when type === "phase_end"). */
  metrics?: PhaseMetrics;
}

export type OnPhaseCallback = (event: PhaseEvent) => void;

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface PhaseMetrics {
  phaseIndex: number;
  rounds: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number;
  durationMs: number;
}

export interface RunMetrics {
  phases: PhaseMetrics[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalTokens: number;
  totalCost: number;
  totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Run Result
// ---------------------------------------------------------------------------

export type RunStatus =
  | "completed"
  | "phase_budget"
  | "max_cost"
  | "error";

export interface RunResult {
  status: RunStatus;
  /** Final state after all phases (or last successful phase). */
  state: State;
  /** Structured output from the final phase's done() result field. */
  output?: Record<string, unknown>;
  /** Aggregated metrics across all phases. */
  metrics: RunMetrics;
  /** Per-phase summaries. */
  phaseSummaries: string[];
  /** Error message if status is "error". */
  error?: string;
}

// ---------------------------------------------------------------------------
// Phase Result (internal)
// ---------------------------------------------------------------------------

export interface PhaseResult {
  status: "completed" | "phase_budget" | "error";
  state: State;
  summary: string;
  result?: Record<string, unknown>;
  metrics: PhaseMetrics;
  stateDiff: StateDiff;
  error?: string;
}

// ---------------------------------------------------------------------------
// Executor Config
// ---------------------------------------------------------------------------

export interface ExecutorConfig {
  /** Model to use for all LLM calls. */
  model: Model<any>;
  /** System prompt for X (the executor identity). */
  systemPrompt: string;
  /** Tool registry — phases reference these by key. */
  tools: ToolRegistry;
  /** Max cost in USD across the entire run. Default: 2.00. */
  maxCostUsd?: number;
  /** Max tokens per phase conversation. Default: 30000. */
  phaseBudget?: number;
  /** Hard backstop on LLM calls per phase. Default: 15. */
  maxPhaseRounds?: number;
  /** Optional Zod-compatible schema for state validation after done(). */
  stateSchema?: { safeParse: (data: unknown) => { success: boolean; error?: { issues: Array<{ path: (string | number)[]; message: string }> } } };
  /** Callback for phase lifecycle events. */
  onPhase?: OnPhaseCallback;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Run Options
// ---------------------------------------------------------------------------

/** Run with a caller-provided plan. */
export interface RunWithPlan {
  plan: Plan;
  initialState?: State;
}

/** Run with Phase 0 plan generation. */
export interface RunWithTask {
  task: string;
  initialState?: State;
  /** Tools available during Phase 0 (plan generation). Default: all read-only tools. */
  planningTools?: string[];
}

export type RunOptions = RunWithPlan | RunWithTask;

export function isRunWithPlan(opts: RunOptions): opts is RunWithPlan {
  return "plan" in opts;
}
