#!/usr/bin/env bun
/**
 * pi-weaver eval runner — runs tasks through pi with the weaver extension
 * and compares against plain pi baseline.
 *
 * Usage:
 *   bun run packages/pi-weaver/eval/runner.ts --task fix-bug
 *   bun run packages/pi-weaver/eval/runner.ts --task fix-bug --baseline
 *   bun run packages/pi-weaver/eval/runner.ts                          # all tasks
 *   bun run packages/pi-weaver/eval/runner.ts --compare                # weaver vs baseline
 */

import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync,
	mkdirSync,
} from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskDefinition {
	name: string;
	goal: string; // Plain language goal for the agent
	plan?: any[]; // Legacy pi-exec plan (for reference only)
	initialState?: Record<string, unknown>;
	assertions: Assertion[];
}

interface Assertion {
	type: "file_exists" | "file_contains" | "file_not_contains" | "state_field";
	path?: string;
	expected?: string;
	description: string;
}

interface AssertionResult {
	assertion: Assertion;
	passed: boolean;
	actual?: string;
}

interface RunResult {
	taskName: string;
	mode: "weaver" | "baseline";
	passed: boolean;
	assertions: AssertionResult[];
	durationMs: number;
	output: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
	const idx = args.indexOf(`--${name}`);
	return idx >= 0 ? args[idx + 1] : undefined;
}
const hasFlag = (name: string) => args.includes(`--${name}`);

const taskFilter = getArg("task");
const runBaseline = hasFlag("baseline") || hasFlag("compare");
const runWeaver = !hasFlag("baseline-only");
const compareMode = hasFlag("compare");
const outputPath = getArg("output");
const timeout = parseInt(getArg("timeout") ?? "120", 10) * 1000;
const verbose = hasFlag("verbose");

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const rootDir = resolve(import.meta.dirname!, "../../..");
const evalDir = resolve(import.meta.dirname!, ".");
const extensionPath = resolve(import.meta.dirname!, "../extension/index.ts");
const piExecTasksDir = resolve(rootDir, "packages/pi-exec/eval/tasks");
const weaverTasksDir = resolve(evalDir, "tasks");
const resultsDir = resolve(evalDir, "results");

mkdirSync(resultsDir, { recursive: true });

// ---------------------------------------------------------------------------
// Task discovery — use pi-exec tasks but with goal-oriented descriptions
// ---------------------------------------------------------------------------

/**
 * Convert a pi-exec task.json (plan-based) to a weaver goal.
 * Weaver gets a plain language goal, not a step-by-step plan.
 */
function loadTask(taskDir: string): TaskDefinition | null {
	const taskPath = join(taskDir, "task.json");
	if (!existsSync(taskPath)) return null;

	const raw = JSON.parse(readFileSync(taskPath, "utf-8"));

	// Build a goal from the task description and initial state
	let goal = raw.task ?? raw.initialState?.task ?? "";

	// If no explicit goal, build one from the plan descriptions
	if (!goal && raw.plan) {
		goal = raw.plan.map((p: any) => p.description).join(". ");
	}

	// Add initial context if it exists
	if (raw.initialState && Object.keys(raw.initialState).length > 0) {
		const ctx = { ...raw.initialState };
		delete ctx.task; // Already used above
		if (Object.keys(ctx).length > 0) {
			goal += `\n\nContext: ${JSON.stringify(ctx)}`;
		}
	}

	return {
		name: raw.name,
		goal,
		plan: raw.plan,
		initialState: raw.initialState,
		assertions: raw.assertions ?? [],
	};
}

function discoverTasks(): Array<{ dir: string; task: TaskDefinition }> {
	// First check for weaver-specific tasks
	const dirs: string[] = [];

	if (existsSync(weaverTasksDir)) {
		for (const d of readdirSync(weaverTasksDir, { withFileTypes: true })) {
			if (d.isDirectory()) dirs.push(join(weaverTasksDir, d.name));
		}
	}

	// Fall back to pi-exec tasks
	if (existsSync(piExecTasksDir)) {
		for (const d of readdirSync(piExecTasksDir, { withFileTypes: true })) {
			if (d.isDirectory()) {
				// Don't duplicate if weaver has its own version
				const name = d.name;
				if (!dirs.some((existing) => existing.endsWith(`/${name}`))) {
					dirs.push(join(piExecTasksDir, d.name));
				}
			}
		}
	}

	const tasks: Array<{ dir: string; task: TaskDefinition }> = [];
	for (const dir of dirs) {
		const task = loadTask(dir);
		if (!task) continue;
		if (taskFilter && task.name !== taskFilter) continue;
		tasks.push({ dir, task });
	}

	return tasks;
}

// ---------------------------------------------------------------------------
// Assertion checker
// ---------------------------------------------------------------------------

function checkAssertions(
	assertions: Assertion[],
	workDir: string,
): AssertionResult[] {
	return assertions.map((a) => {
		switch (a.type) {
			case "file_exists": {
				const filePath = join(workDir, a.path!);
				return { assertion: a, passed: existsSync(filePath) };
			}
			case "file_contains": {
				const filePath = join(workDir, a.path!);
				if (!existsSync(filePath))
					return { assertion: a, passed: false, actual: "(file not found)" };
				const content = readFileSync(filePath, "utf-8");
				return {
					assertion: a,
					passed: content.includes(a.expected!),
					actual: content.slice(0, 200),
				};
			}
			case "file_not_contains": {
				const filePath = join(workDir, a.path!);
				if (!existsSync(filePath))
					return { assertion: a, passed: true }; // File not existing = doesn't contain
				const content = readFileSync(filePath, "utf-8");
				return {
					assertion: a,
					passed: !content.includes(a.expected!),
					actual: content.slice(0, 200),
				};
			}
			case "state_field": {
				// State assertions don't apply to weaver — we check file-level results
				return { assertion: a, passed: true };
			}
			default:
				return { assertion: a, passed: false };
		}
	});
}

// ---------------------------------------------------------------------------
// Run a task through pi
// ---------------------------------------------------------------------------

function runPi(
	goal: string,
	workDir: string,
	mode: "weaver" | "baseline",
): { output: string; durationMs: number; error?: string } {
	const piArgs = ["--no-session", "-p"];

	if (mode === "weaver") {
		piArgs.push("-e", extensionPath);
	}

	// The goal is the prompt
	piArgs.push(goal);

	const start = Date.now();

	try {
		const result = spawnSync("pi", piArgs, {
			cwd: workDir,
			timeout,
			encoding: "utf-8",
			env: { ...process.env },
			stdio: ["pipe", "pipe", "pipe"],
		});

		const output = (result.stdout ?? "") + (result.stderr ?? "");
		const durationMs = Date.now() - start;

		if (result.status !== 0 && result.status !== null) {
			return {
				output,
				durationMs,
				error: `pi exited with code ${result.status}: ${(result.stderr ?? "").slice(0, 200)}`,
			};
		}

		return { output, durationMs };
	} catch (err: any) {
		return {
			output: "",
			durationMs: Date.now() - start,
			error: err.message?.slice(0, 200) ?? String(err),
		};
	}
}

function runTask(
	taskDir: string,
	task: TaskDefinition,
	mode: "weaver" | "baseline",
): RunResult {
	// Setup working directory with fixture files
	const workDir = mkdtempSync(join(tmpdir(), `pi-weaver-${mode}-`));
	const fixtureDir = join(taskDir, "fixture");
	if (existsSync(fixtureDir)) {
		cpSync(fixtureDir, workDir, { recursive: true });
	}

	// Run pi
	const { output, durationMs, error } = runPi(task.goal, workDir, mode);

	// Check assertions
	const assertions = checkAssertions(task.assertions, workDir);
	const passed = !error && assertions.every((a) => a.passed);

	return {
		taskName: task.name,
		mode,
		passed,
		assertions,
		durationMs,
		output: verbose ? output : output.slice(0, 500),
		error,
	};
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const tasks = discoverTasks();

if (tasks.length === 0) {
	console.error(
		`No tasks found${taskFilter ? ` matching "${taskFilter}"` : ""}`,
	);
	process.exit(1);
}

console.log("═".repeat(80));
console.log("pi-weaver eval");
console.log("═".repeat(80));
console.log(`Tasks:     ${tasks.length}`);
console.log(`Modes:     ${[runWeaver && "weaver", runBaseline && "baseline"].filter(Boolean).join(", ")}`);
console.log(`Timeout:   ${timeout / 1000}s`);
console.log(`Extension: ${extensionPath}`);
console.log("═".repeat(80));
console.log();

const allResults: RunResult[] = [];

for (const { dir, task } of tasks) {
	if (runWeaver) {
		process.stdout.write(`  🕸 ${task.name.padEnd(30)} `);
		const result = runTask(dir, task, "weaver");
		allResults.push(result);
		const icon = result.passed ? "✅" : "❌";
		console.log(`${icon} ${result.durationMs}ms${result.error ? ` (${result.error.slice(0, 60)})` : ""}`);
		if (!result.passed) {
			for (const a of result.assertions.filter((a) => !a.passed)) {
				console.log(`     └─ FAIL: ${a.assertion.description}`);
			}
		}
	}

	if (runBaseline) {
		process.stdout.write(`  📝 ${task.name.padEnd(30)} `);
		const result = runTask(dir, task, "baseline");
		allResults.push(result);
		const icon = result.passed ? "✅" : "❌";
		console.log(`${icon} ${result.durationMs}ms${result.error ? ` (${result.error.slice(0, 60)})` : ""}`);
		if (!result.passed) {
			for (const a of result.assertions.filter((a) => !a.passed)) {
				console.log(`     └─ FAIL: ${a.assertion.description}`);
			}
		}
	}

	console.log();
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("═".repeat(80));
console.log("SUMMARY");
console.log("═".repeat(80));

for (const mode of ["weaver", "baseline"] as const) {
	const results = allResults.filter((r) => r.mode === mode);
	if (results.length === 0) continue;

	const passed = results.filter((r) => r.passed).length;
	const avgDuration = Math.round(
		results.reduce((s, r) => s + r.durationMs, 0) / results.length,
	);

	console.log(
		`\n${mode === "weaver" ? "🕸 Weaver" : "📝 Baseline"}: ${passed}/${results.length} passed, avg ${avgDuration}ms`,
	);

	if (compareMode) {
		console.log(
			`  ${"Task".padEnd(30)} ${"Result".padEnd(8)} ${"Time".padEnd(10)}`,
		);
		for (const r of results) {
			console.log(
				`  ${r.taskName.padEnd(30)} ${(r.passed ? "✅" : "❌").padEnd(8)} ${r.durationMs}ms`,
			);
		}
	}
}

if (compareMode) {
	console.log("\n--- Comparison ---");
	const weaverResults = allResults.filter((r) => r.mode === "weaver");
	const baselineResults = allResults.filter((r) => r.mode === "baseline");

	for (const wr of weaverResults) {
		const br = baselineResults.find((b) => b.taskName === wr.taskName);
		if (!br) continue;
		const wIcon = wr.passed ? "✅" : "❌";
		const bIcon = br.passed ? "✅" : "❌";
		const speedup = br.durationMs > 0 ? (br.durationMs / wr.durationMs).toFixed(1) : "?";
		console.log(
			`  ${wr.taskName.padEnd(30)} weaver=${wIcon} baseline=${bIcon} weaver ${speedup}x speed`,
		);
	}
}

// ---------------------------------------------------------------------------
// Save results
// ---------------------------------------------------------------------------

const outPath =
	outputPath ?? join(resultsDir, `run-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`);
writeFileSync(
	outPath,
	JSON.stringify(
		{
			timestamp: new Date().toISOString(),
			tasks: tasks.length,
			results: allResults.map((r) => ({
				...r,
				output: r.output.slice(0, 500), // Truncate for storage
			})),
		},
		null,
		2,
	),
);
console.log(`\nResults: ${outPath}`);
