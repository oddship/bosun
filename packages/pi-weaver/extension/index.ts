/**
 * pi-weaver — Time Lapse execution extension for Pi.
 *
 * Transforms pi into an autonomous executor with:
 * - checkpoint: save named progress points
 * - time_lapse: rewind to a checkpoint with steering (like Weaver's ultimate)
 * - done: gated completion with harness verification
 *
 * Usage:
 *   pi -e ./packages/pi-weaver/extension/index.ts "your goal here"
 *   pi --no-session -p -e ./packages/pi-weaver/extension/index.ts "your goal here"
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { WEAVER_PROMPT } from "./prompt.js";

interface CheckpointData {
	label: string;
	state: Record<string, unknown>;
	entryId: string;
	timestamp: number;
}

export default function weaver(pi: ExtensionAPI) {
	const checkpoints = new Map<string, CheckpointData>();
	let doneCallCount = 0;
	let isWeaverMode = false;

	// -----------------------------------------------------------------------
	// Restore state on session start/resume
	// -----------------------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		checkpoints.clear();
		doneCallCount = 0;

		for (const entry of ctx.sessionManager.getEntries()) {
			if (
				entry.type === "custom" &&
				(entry as any).customType === "weaver-checkpoint"
			) {
				const data = (entry as any).data as CheckpointData;
				checkpoints.set(data.label, data);
			}
			if (
				entry.type === "custom" &&
				(entry as any).customType === "weaver-active"
			) {
				isWeaverMode = true;
			}
		}

		if (isWeaverMode) {
			updateStatus(ctx);
		}
	});

	// -----------------------------------------------------------------------
	// Inject weaver system prompt
	// -----------------------------------------------------------------------

	pi.on("before_agent_start", async (event) => {
		// Always inject — the tools are available, the prompt teaches usage
		isWeaverMode = true;
		pi.appendEntry("weaver-active", { timestamp: Date.now() });
		return {
			systemPrompt: event.systemPrompt + "\n\n" + WEAVER_PROMPT,
		};
	});

	// -----------------------------------------------------------------------
	// Status tracking
	// -----------------------------------------------------------------------

	function updateStatus(ctx: ExtensionContext) {
		if (!isWeaverMode) return;
		const cpCount = checkpoints.size;
		if (cpCount > 0) {
			const labels = [...checkpoints.keys()].slice(-3).join(", ");
			ctx.ui.setStatus(
				"weaver",
				ctx.ui.theme.fg("accent", `🕸 ${cpCount} checkpoints: ${labels}`),
			);
		} else {
			ctx.ui.setStatus("weaver", ctx.ui.theme.fg("muted", "🕸 weaver"));
		}
	}

	// -----------------------------------------------------------------------
	// Tool: checkpoint
	// -----------------------------------------------------------------------

	pi.registerTool({
		name: "checkpoint",
		label: "Checkpoint",
		description:
			"Save a named checkpoint with structured state. Use before risky operations " +
			"or to mark progress that you might want to return to via time_lapse.",
		promptSnippet: "Save named checkpoint with structured state for time_lapse",
		parameters: Type.Object({
			label: Type.String({
				description: "Short name for this checkpoint (e.g., 'map', 'batch_1_done', 'before_fix')",
			}),
			state: Type.Record(Type.String(), Type.Unknown(), {
				description:
					"Structured state to preserve. Should contain everything needed to continue " +
					"if conversation context were lost. Use structured data, not prose.",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const leafId = ctx.sessionManager.getLeafId();
			if (!leafId) {
				throw new Error("No active session entry to checkpoint");
			}

			const data: CheckpointData = {
				label: params.label,
				state: params.state,
				entryId: leafId,
				timestamp: Date.now(),
			};

			checkpoints.set(params.label, data);
			pi.appendEntry("weaver-checkpoint", data);
			pi.setLabel(leafId, `📌 ${params.label}`);
			updateStatus(ctx);

			return {
				content: [
					{
						type: "text",
						text: `Checkpoint "${params.label}" saved. State keys: ${Object.keys(params.state).join(", ")}`,
					},
				],
				details: data,
			};
		},
	});

	// -----------------------------------------------------------------------
	// Tool: time_lapse
	// -----------------------------------------------------------------------

	pi.registerTool({
		name: "time_lapse",
		label: "Time Lapse",
		description:
			"Rewind to a named checkpoint, abandoning the current approach. " +
			"Everything after the checkpoint is summarized and injected as context. " +
			"Use when: wrong approach, context is bloated, or you need to try differently. " +
			"The steering text should explain WHAT you tried, WHY it failed, and WHAT to do next.",
		promptSnippet:
			"Rewind to checkpoint — abandons current approach, injects summary + steering",
		parameters: Type.Object({
			target: Type.String({
				description: "Checkpoint label to rewind to",
			}),
			steering: Type.String({
				description:
					"Steering text: what you tried, why it failed, what to do differently. " +
					"This becomes your context after rewinding.",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cp = checkpoints.get(params.target);
			if (!cp) {
				const available = [...checkpoints.keys()].join(", ") || "(none)";
				throw new Error(
					`Checkpoint "${params.target}" not found. Available: ${available}`,
				);
			}

			// Build summary of what we're abandoning
			const currentLeaf = ctx.sessionManager.getLeafId();
			const abandonedSummary = buildAbandonedSummary(ctx, cp.entryId, currentLeaf);

			// Record the time_lapse event
			pi.appendEntry("weaver-time-lapse", {
				from: currentLeaf,
				to: cp.entryId,
				target: params.target,
				steering: params.steering,
				timestamp: Date.now(),
			});

			// Abort current agent loop — this stops the model from continuing
			ctx.abort();

			// Inject the branch summary + steering + checkpoint state as a follow-up
			// that triggers a new turn. The model starts fresh with:
			// 1. The conversation up to the checkpoint
			// 2. A summary of the abandoned branch
			// 3. The steering text
			// 4. The checkpoint's structured state
			const stateJson = JSON.stringify(cp.state, null, 2);
			const content = [
				`## Time Lapse → "${params.target}"`,
				"",
				"### What was tried (abandoned branch)",
				abandonedSummary,
				"",
				"### New direction",
				params.steering,
				"",
				"### Checkpoint state",
				"```json",
				stateJson,
				"```",
				"",
				"Continue from this checkpoint. Follow the new direction above.",
				"Your pseudocode plan is still in context — refer to it.",
			].join("\n");

			pi.sendMessage(
				{
					customType: "weaver-time-lapse-context",
					content,
					display: true,
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);

			return {
				content: [
					{
						type: "text",
						text: `Time lapsing to "${params.target}"... Branch summary injected.`,
					},
				],
				details: { target: params.target, steering: params.steering },
			};
		},
	});

	// -----------------------------------------------------------------------
	// Tool: done
	// -----------------------------------------------------------------------

	pi.registerTool({
		name: "done",
		label: "Done",
		description:
			"Signal task completion. First call triggers harness verification — " +
			"the harness checks your work and reports back. Fix any issues found. " +
			"Second call confirms completion.",
		promptSnippet: "Signal completion — first call triggers verification, second confirms",
		parameters: Type.Object({
			summary: Type.String({
				description: "What you accomplished",
			}),
			state: Type.Optional(
				Type.Record(Type.String(), Type.Unknown(), {
					description: "Final state (optional, for structured output)",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			doneCallCount++;

			if (doneCallCount === 1) {
				// First done() — run verification
				const issues = await runVerification(ctx, params.summary);

				if (issues.length === 0) {
					// Clean — accept immediately
					pi.appendEntry("weaver-done", {
						summary: params.summary,
						state: params.state,
						verified: true,
						timestamp: Date.now(),
					});

					return {
						content: [
							{
								type: "text",
								text: "✅ Verification passed. Task complete.\n\nSummary: " + params.summary,
							},
						],
						details: { summary: params.summary, state: params.state, verified: true },
					};
				}

				// Issues found — report back
				const issueList = issues.map((i) => `- ${i}`).join("\n");
				return {
					content: [
						{
							type: "text",
							text:
								`⚠️ Verification found issues:\n${issueList}\n\n` +
								"Fix these issues, then call done() again.",
						},
					],
					details: { issues, verified: false },
				};
			}

			// Second+ done() — accept
			pi.appendEntry("weaver-done", {
				summary: params.summary,
				state: params.state,
				verified: true,
				attempt: doneCallCount,
				timestamp: Date.now(),
			});

			return {
				content: [
					{
						type: "text",
						text: "✅ Task complete.\n\nSummary: " + params.summary,
					},
				],
				details: { summary: params.summary, state: params.state, verified: true },
			};
		},
	});

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	/**
	 * Build a text summary of the work being abandoned (entries between
	 * checkpoint and current leaf). This is a simple version — extracts
	 * tool calls and assistant text. A production version would use an LLM.
	 */
	function buildAbandonedSummary(
		ctx: ExtensionContext,
		checkpointEntryId: string,
		currentLeafId: string | null,
	): string {
		const entries = ctx.sessionManager.getBranch();

		// Find the range of entries to summarize
		let inRange = false;
		const toolCalls: string[] = [];
		const textSnippets: string[] = [];

		for (const entry of entries) {
			if (entry.id === checkpointEntryId) {
				inRange = true;
				continue;
			}
			if (!inRange) continue;

			if (entry.type === "message") {
				const msg = (entry as any).message;
				if (msg?.role === "assistant" && Array.isArray(msg.content)) {
					for (const block of msg.content) {
						if (block.type === "toolCall") {
							const args = typeof block.arguments === "object"
								? Object.keys(block.arguments).map((k) => `${k}=${JSON.stringify((block.arguments as any)[k]).slice(0, 50)}`).join(", ")
								: "";
							toolCalls.push(`${block.name}(${args})`);
						}
						if (block.type === "text" && block.text) {
							const snippet = block.text.slice(0, 200);
							if (snippet.trim()) textSnippets.push(snippet);
						}
					}
				}
			}
		}

		const parts: string[] = [];
		if (toolCalls.length > 0) {
			parts.push(`Tool calls: ${toolCalls.join(", ")}`);
		}
		if (textSnippets.length > 0) {
			parts.push(`Key text: ${textSnippets.slice(0, 3).join(" | ")}`);
		}

		return parts.length > 0
			? parts.join("\n")
			: "No significant work to summarize.";
	}

	/**
	 * Run verification checks when done() is called.
	 * For now: basic checks. The eval harness can inject custom verifiers.
	 */
	async function runVerification(
		ctx: ExtensionContext,
		_summary: string,
	): Promise<string[]> {
		const issues: string[] = [];

		// Check if any checkpoints have "remaining" work in their state
		for (const [label, cp] of checkpoints) {
			const remaining = cp.state.remaining;
			if (remaining && Array.isArray(remaining) && remaining.length > 0) {
				issues.push(
					`Checkpoint "${label}" still has remaining items: ${remaining.join(", ")}`,
				);
			}
		}

		return issues;
	}
}
