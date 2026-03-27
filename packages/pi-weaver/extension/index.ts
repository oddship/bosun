/**
 * pi-weaver — Time Lapse execution extension for Pi.
 *
 * Transforms pi into an autonomous executor with:
 * - checkpoint: save named progress points
 * - time_lapse: rewind to a checkpoint with steering (like Weaver's ultimate)
 * - done: gated completion with harness verification
 *
 * Usage:
 *   pi -e ./packages/pi-weaver/extension/index.ts
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

interface TimeLapseIntent {
	nonce: string;
	targetEntryId: string;
	checkpointLabel: string;
	steering: string;
	checkpointState: Record<string, unknown>;
	timestamp: number;
}

export default function weaver(pi: ExtensionAPI) {
	const checkpoints = new Map<string, CheckpointData>();
	let doneCallCount = 0;
	let isWeaverMode = false;
	let activeIntent: TimeLapseIntent | null = null;

	// Intent storage — tool writes, command reads
	const pendingIntents = new Map<string, TimeLapseIntent>();

	// -----------------------------------------------------------------------
	// Restore state on session start/resume
	// -----------------------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		checkpoints.clear();
		pendingIntents.clear();
		activeIntent = null;
		doneCallCount = 0;

		for (const entry of ctx.sessionManager.getEntries()) {
			const e = entry as any;
			if (e.type === "custom" && e.customType === "weaver-checkpoint") {
				const data = e.data as CheckpointData;
				checkpoints.set(data.label, data);
			}
			if (e.type === "custom" && e.customType === "weaver-active") {
				isWeaverMode = true;
			}
		}

		if (isWeaverMode) {
			updateStatus(ctx);
		}
	});

	// -----------------------------------------------------------------------
	// Rebuild checkpoint cache after tree navigation
	// -----------------------------------------------------------------------

	pi.on("session_tree", async (_event, ctx) => {
		// After navigateTree, the branch may have changed.
		// Rebuild checkpoint map from the new branch's entries.
		checkpoints.clear();
		for (const entry of ctx.sessionManager.getEntries()) {
			const e = entry as any;
			if (e.type === "custom" && e.customType === "weaver-checkpoint") {
				const data = e.data as CheckpointData;
				checkpoints.set(data.label, data);
			}
		}
		updateStatus(ctx);
	});

	// -----------------------------------------------------------------------
	// Custom branch summary for weaver-initiated tree navigation
	// -----------------------------------------------------------------------

	pi.on("session_before_tree", async (event) => {
		if (!activeIntent) return; // Not a weaver-initiated navigation

		// Override the summary prompt to focus on what was tried and why
		return {
			customInstructions:
				"Summarize the abandoned branch focusing on: " +
				"what approach was tried, what happened, why it's being abandoned, " +
				"and any constraints or knowledge learned. Be concise — this will be " +
				"injected as context for the next attempt.",
			label: `🕸 time_lapse → ${activeIntent.checkpointLabel}`,
		};
	});

	// -----------------------------------------------------------------------
	// Inject weaver system prompt
	// -----------------------------------------------------------------------

	pi.on("before_agent_start", async (event) => {
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
				description:
					"Short name for this checkpoint (e.g., 'map', 'batch_1_done', 'before_fix')",
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
	// Tool: time_lapse (phase 1 — store intent, queue command)
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

			// Generate a unique nonce for this intent
			const nonce = `tl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

			const intent: TimeLapseIntent = {
				nonce,
				targetEntryId: cp.entryId,
				checkpointLabel: params.target,
				steering: params.steering,
				checkpointState: cp.state,
				timestamp: Date.now(),
			};

			// Store intent for the command to pick up
			pendingIntents.set(nonce, intent);

			// Persist the intent to session (survives crashes)
			pi.appendEntry("weaver-time-lapse-intent", intent);

			// Abort current agent loop — stop burning context on wrong path
			ctx.abort();

			// Queue the rewind command as followUp — runs after agent is idle
			pi.sendUserMessage(`/weaver-time-lapse ${nonce}`, {
				deliverAs: "followUp",
			});

			return {
				content: [
					{
						type: "text",
						text: `⏪ Time lapsing to "${params.target}"... Rewind queued.`,
					},
				],
				details: { nonce, target: params.target },
			};
		},
	});

	// -----------------------------------------------------------------------
	// Command: /weaver-time-lapse (phase 2 — perform the actual rewind)
	// -----------------------------------------------------------------------

	pi.registerCommand("weaver-time-lapse", {
		description: "Internal: perform time_lapse rewind (called by time_lapse tool)",
		handler: async (args, ctx) => {
			const nonce = args.trim();
			const intent = pendingIntents.get(nonce);

			if (!intent) {
				ctx.ui.notify(`Time lapse intent ${nonce} not found`, "error");
				return;
			}

			pendingIntents.delete(nonce);

			// Set active intent so session_before_tree can customize the summary
			activeIntent = intent;

			try {
				// Wait for everything to settle
				await ctx.waitForIdle();

				// Perform the actual tree navigation — this is the real rewind.
				// navigateTree handles:
				// - finding common ancestor
				// - generating branch summary (customized by our session_before_tree hook)
				// - calling branch/branchWithSummary on SessionManager
				// - rebuilding agent context via agent.replaceMessages()
				// - emitting session_before_tree / session_tree events
				const result = await ctx.navigateTree(intent.targetEntryId, {
					summarize: true,
					customInstructions:
						"Summarize what was tried on the abandoned branch, " +
						"why it's being abandoned, and key constraints learned.",
					label: `🕸 time_lapse → ${intent.checkpointLabel}`,
				});

				if (result.cancelled) {
					ctx.ui.notify("Time lapse was cancelled", "warning");
					return;
				}

				// Persist the completed rewind
				pi.appendEntry("weaver-time-lapse-done", {
					nonce: intent.nonce,
					checkpointLabel: intent.checkpointLabel,
					timestamp: Date.now(),
				});

				// Inject steering + checkpoint state as the next message.
				// This kicks off a new turn from the rewound position.
				const stateJson = JSON.stringify(intent.checkpointState, null, 2);
				const steeringMessage = [
					`## Time Lapse → "${intent.checkpointLabel}"`,
					"",
					"### New direction",
					intent.steering,
					"",
					"### Checkpoint state",
					"```json",
					stateJson,
					"```",
					"",
					"Continue from this checkpoint following the new direction above.",
					"Your pseudocode plan is still in context — refer to it.",
				].join("\n");

				pi.sendUserMessage(steeringMessage);
			} finally {
				activeIntent = null;
			}
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
		promptSnippet:
			"Signal completion — first call triggers verification, second confirms",
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
								text:
									"✅ Verification passed. Task complete.\n\nSummary: " +
									params.summary,
							},
						],
						details: {
							summary: params.summary,
							state: params.state,
							verified: true,
						},
					};
				}

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
				details: {
					summary: params.summary,
					state: params.state,
					verified: true,
				},
			};
		},
	});

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	/**
	 * Run verification checks when done() is called.
	 * Basic checks for now — Harbor's verifier handles real test verification.
	 */
	async function runVerification(
		_ctx: ExtensionContext,
		_summary: string,
	): Promise<string[]> {
		const issues: string[] = [];

		// Check if any checkpoints have remaining work
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
