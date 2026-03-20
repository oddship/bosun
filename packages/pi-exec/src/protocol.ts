/**
 * pi-exec protocol — prompt building, done() extraction, state diffing.
 */

import type { AssistantMessage, ToolCall } from "@mariozechner/pi-ai";
import type { Phase, Plan, State, StateDiff } from "./types.js";
import type { DoneCallArgs } from "./tools.js";

// ---------------------------------------------------------------------------
// Cached prefix (stable across all phases)
// ---------------------------------------------------------------------------

const EXECUTION_INSTRUCTIONS = `
## Instructions

Execute the current phase using tools. When done, call done() with:
- state: updated working state (everything subsequent phases need)
- summary: what you accomplished

Act efficiently. Use tools, don't narrate. Record findings in structured state.
`.trim();

/**
 * Build the cached prefix: system prompt + instructions + plan.
 * This is stable across all phases and benefits from prompt caching.
 */
export function buildCachedPrefix(systemPrompt: string, plan: Plan): string {
  const planText = plan
    .map((phase, i) => `  Phase ${i + 1}: ${phase.description} [tools: ${phase.tools.join(", ")}]`)
    .join("\n");

  return `${systemPrompt}

${EXECUTION_INSTRUCTIONS}

## Plan

${planText}
`.trim();
}

// ---------------------------------------------------------------------------
// Per-phase user message
// ---------------------------------------------------------------------------

/**
 * Build the user message for a phase: current state + phase marker.
 * Optional budgetNote is appended when approaching the phase budget.
 */
export function buildPhasePrompt(
  state: State,
  phase: Phase,
  phaseIndex: number,
  totalPhases: number,
  budgetNote?: string,
): string {
  const stateJson = JSON.stringify(state, null, 2);
  const parts = [
    `## Current State\n${stateJson}`,
    `You are executing Phase ${phaseIndex + 1} of ${totalPhases}: ${phase.description}`,
  ];
  if (budgetNote) {
    parts.push(budgetNote);
  }
  return parts.join("\n\n");
}

/**
 * Build the user message for a gate sub-phase.
 *
 * The gate verifier checks whether the work phase accomplished its goal.
 * It calls done() with result.passed (boolean) and result.issues (string[]).
 */
export function buildGatePrompt(
  state: State,
  gateDescription: string,
  phaseDescription: string,
): string {
  return `## Verification Gate

You are verifying that the previous phase accomplished its goal.

**Phase that was executed:** ${phaseDescription}

**What to verify:** ${gateDescription}

## Current State
${JSON.stringify(state, null, 2)}

Check the verification criteria using the available tools. When done, call done() with:
- state: the current state (pass it through unchanged)
- summary: what you found
- result: { "passed": true } if all criteria met, or { "passed": false, "issues": ["issue1", "issue2"] } if not`;
}

/**
 * Build the force-done user message when budget is exceeded.
 */
export function buildForceDonePrompt(state: State): string {
  return `Phase budget exceeded. You must call done() now with your current working state.

## Current State
${JSON.stringify(state, null, 2)}`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Extract all ToolCall items from an AssistantMessage.
 */
export function extractToolCalls(response: AssistantMessage): ToolCall[] {
  return response.content.filter(
    (c): c is ToolCall => c.type === "toolCall",
  );
}

/**
 * Extract a done() call from an AssistantMessage, if present.
 * Returns null if no done() call found.
 */
export function extractDoneCall(response: AssistantMessage): DoneCallArgs | null {
  const doneCall = response.content.find(
    (c): c is ToolCall => c.type === "toolCall" && c.name === "done",
  );
  if (!doneCall) return null;

  const args = doneCall.arguments as DoneCallArgs;
  // Basic shape validation — typeof null === "object" in JS, so check explicitly
  if (!args || args.state === null || typeof args.state !== "object" || typeof args.summary !== "string") {
    return null;
  }
  return args;
}

/**
 * Check if a response contains any non-done tool calls alongside a done() call.
 */
export function hasToolCallsWithDone(response: AssistantMessage): boolean {
  const toolCalls = extractToolCalls(response);
  const hasDone = toolCalls.some((tc) => tc.name === "done");
  const hasOther = toolCalls.some((tc) => tc.name !== "done");
  return hasDone && hasOther;
}

// ---------------------------------------------------------------------------
// State diffing
// ---------------------------------------------------------------------------

/**
 * Compute a diff between two states (for debugging/logging).
 */
export function diffState(prev: State, next: State): StateDiff {
  const prevKeys = new Set(Object.keys(prev));
  const nextKeys = new Set(Object.keys(next));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const key of nextKeys) {
    if (!prevKeys.has(key)) {
      added.push(key);
    } else if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      changed.push(key);
    }
  }

  for (const key of prevKeys) {
    if (!nextKeys.has(key)) {
      removed.push(key);
    }
  }

  return { added, removed, changed };
}

// ---------------------------------------------------------------------------
// State validation
// ---------------------------------------------------------------------------

/**
 * Build an error message for state validation failures.
 */
export function buildValidationErrorMessage(errors: Array<{ path: (string | number)[]; message: string }>): string {
  const errorLines = errors.map(
    (e) => `  - ${e.path.join(".")}: ${e.message}`,
  );
  return `State validation failed. Please call done() again with corrected state:\n${errorLines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Plan validation (for Phase 0 output)
// ---------------------------------------------------------------------------

/**
 * Validate that a Phase 0 output contains a valid plan.
 * Returns the plan or throws with a descriptive error.
 */
export function validatePlanFromState(state: State): Plan {
  const plan = state.plan;
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new Error("Phase 0 did not produce a valid plan. Expected state.plan to be a non-empty array.");
  }

  for (let i = 0; i < plan.length; i++) {
    const phase = plan[i];
    if (!phase || typeof phase.description !== "string" || !phase.description) {
      throw new Error(`Phase 0 plan[${i}] missing description.`);
    }
    if (!Array.isArray(phase.tools)) {
      throw new Error(`Phase 0 plan[${i}] missing tools array.`);
    }
  }

  return plan as Plan;
}
