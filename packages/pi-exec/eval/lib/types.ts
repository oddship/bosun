/**
 * Task definition format for eval tasks.
 */
import type { Phase, State } from "pi-exec";

export interface TaskDefinition {
  /** Task name (used in reporting). */
  name: string;

  /** Task description (for Phase 0 plan generation mode). */
  task?: string;

  /** Explicit plan (skip Phase 0). */
  plan?: Phase[];

  /** Initial state to pass to executor. */
  initialState?: State;

  /** Custom system prompt (optional). */
  systemPrompt?: string;

  /** Assertions to check on the final state. */
  assertions?: Assertion[];
}

export interface Assertion {
  /** What to check: state field, file exists, file contains text, etc. */
  type: "state_field" | "file_exists" | "file_contains" | "state_matches";

  /** Path to check (state field path or file path). */
  path: string;

  /** Expected value (for state_field) or substring (for file_contains). */
  expected?: unknown;

  /** Human-readable description. */
  description?: string;
}

export interface TaskResult {
  taskName: string;
  model: string;
  passed: boolean;
  assertionResults: AssertionResult[];
  cost: number;
  tokens: number;
  durationMs: number;
  status: string;
  error?: string;
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  actual?: unknown;
  error?: string;
}
