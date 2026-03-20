/**
 * pi-exec metrics — token counting and cost tracking.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { PhaseMetrics, RunMetrics } from "./types.js";

// ---------------------------------------------------------------------------
// Phase-level accumulator
// ---------------------------------------------------------------------------

export class MetricsAccumulator {
  private phaseIndex: number;
  private startTime: number;
  private rounds = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private totalTokens = 0;
  private cost = 0;

  constructor(phaseIndex: number) {
    this.phaseIndex = phaseIndex;
    this.startTime = Date.now();
  }

  /** Record metrics from a single LLM response. */
  addResponse(response: AssistantMessage): void {
    this.rounds++;
    const u = response.usage;
    this.inputTokens += u.input;
    this.outputTokens += u.output;
    this.cacheReadTokens += u.cacheRead;
    this.totalTokens += u.totalTokens;
    this.cost += u.cost.total;
  }

  /** Get current cumulative total tokens (for budget checks). */
  getCumulativeTokens(): number {
    return this.totalTokens;
  }

  /** Get current cumulative cost (for cost limit checks). */
  getCumulativeCost(): number {
    return this.cost;
  }

  /** Get current round count. */
  getRounds(): number {
    return this.rounds;
  }

  /** Finalize and return phase metrics. */
  finalize(): PhaseMetrics {
    return {
      phaseIndex: this.phaseIndex,
      rounds: this.rounds,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      totalTokens: this.totalTokens,
      cost: this.cost,
      durationMs: Date.now() - this.startTime,
    };
  }
}

// ---------------------------------------------------------------------------
// Run-level aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregate per-phase metrics into run-level totals.
 */
export function aggregateMetrics(phaseMetrics: PhaseMetrics[]): RunMetrics {
  const totals: RunMetrics = {
    phases: phaseMetrics,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    totalDurationMs: 0,
  };

  for (const pm of phaseMetrics) {
    totals.totalInputTokens += pm.inputTokens;
    totals.totalOutputTokens += pm.outputTokens;
    totals.totalCacheReadTokens += pm.cacheReadTokens;
    totals.totalTokens += pm.totalTokens;
    totals.totalCost += pm.cost;
    totals.totalDurationMs += pm.durationMs;
  }

  return totals;
}
