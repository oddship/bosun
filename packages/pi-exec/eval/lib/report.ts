/**
 * Report formatter for eval results.
 */

import type { TaskResult } from "./types.js";

export function printReport(results: TaskResult[]): void {
  console.log("\n" + "=".repeat(80));
  console.log("pi-exec Eval Report");
  console.log("=".repeat(80));

  const byModel = groupBy(results, (r) => r.model);
  for (const [model, modelResults] of Object.entries(byModel)) {
    console.log(`\n## ${model}`);
    console.log("-".repeat(60));

    const passed = modelResults.filter((r) => r.passed).length;
    const total = modelResults.length;
    const totalCost = modelResults.reduce((s, r) => s + r.cost, 0);
    const avgDuration = modelResults.reduce((s, r) => s + r.durationMs, 0) / total;

    for (const r of modelResults) {
      const status = r.passed ? "✅" : "❌";
      const assertions = r.assertionResults.length > 0
        ? ` (${r.assertionResults.filter((a) => a.passed).length}/${r.assertionResults.length} assertions)`
        : "";
      console.log(
        `  ${status} ${r.taskName.padEnd(30)} ${r.status.padEnd(14)} $${r.cost.toFixed(4)} ${r.durationMs}ms${assertions}`,
      );
      if (!r.passed && r.error) {
        console.log(`     └─ ${r.error}`);
      }
      for (const a of r.assertionResults.filter((a) => !a.passed)) {
        console.log(`     └─ FAIL: ${a.assertion.description ?? a.assertion.path}: ${a.error ?? `got ${JSON.stringify(a.actual)}`}`);
      }
    }

    console.log(`\n  Summary: ${passed}/${total} passed | $${totalCost.toFixed(4)} total | ${Math.round(avgDuration)}ms avg`);
  }

  console.log("\n" + "=".repeat(80));
}

function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const key = keyFn(item);
    (result[key] ??= []).push(item);
  }
  return result;
}
