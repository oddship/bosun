/**
 * pi-weaver — Time Lapse execution extension for Pi.
 *
 * Gives the model 3 tools for managing its own conversation context:
 * - checkpoint: save named progress points with structured state
 * - time_lapse: rewind to a checkpoint (prunes context via context event)
 * - done: gated completion with harness verification
 *
 * Architecture: time_lapse works by pruning the message array in the
 * `context` event (fires before each LLM call). No sendUserMessage,
 * no command delegation, no followUp timing issues.
 *
 * Usage:
 *   pi -e ./packages/pi-weaver/extension/index.ts
 *   pi -p -e ./packages/pi-weaver/extension/index.ts "your goal here"
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { WEAVER_PROMPT } from "./prompt.js";

interface CheckpointData {
	label: string;
	state: Record<string, unknown>;
	entryId: string;
	/** Index in the message array where this checkpoint's tool result lives */
	messageIndex: number;
	timestamp: number;
}

interface PendingRewind {
	checkpointLabel: string;
	steering: string;
	checkpointState: Record<string, unknown>;
	/** Message index to truncate to (keep messages 0..targetIndex) */
	targetIndex: number;
}

export default function weaver(pi: ExtensionAPI) {
	const checkpoints = new Map<string, CheckpointData>();
	let doneCallCount = 0;
	let isWeaverMode = false;

	// When set, the next `context` event will prune messages and inject steering
	let pendingRewind: PendingRewind | null = null;

	// Track whether the last test/bash failed — used to inject reminders
	let lastTestFailed = false;
	// Track how many edits happened since last checkpoint or time_lapse
	let editsSinceCheckpoint = 0;

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
	// Context event: perform the actual rewind by pruning messages
	// -----------------------------------------------------------------------
	// Fires before each LLM call. If a rewind is pending, we:
	// 1. Keep messages up to and including the checkpoint
	// 2. Append a user message with the steering text + checkpoint state
	// The model sees a clean context and continues from the checkpoint.

	pi.on("context", async (event) => {
		// --- Inject system reminder when test failed after edits ---
		if (!pendingRewind && lastTestFailed && editsSinceCheckpoint > 0 && checkpoints.size > 0) {
			const latestCp = [...checkpoints.keys()].pop();
			const messages = [...event.messages];
			messages.push({
				role: "user" as const,
				content: [
					{
						type: "text" as const,
						text: [
							`⚠️ **WEAVER REMINDER**: Your last test/command failed after ${editsSinceCheckpoint} edit(s).`,
							`Rule: edit → test → fail → time_lapse("${latestCp}", "what I tried, why it failed, what to try next").`,
							`Do NOT edit again. Call time_lapse now to rewind and try a different approach.`,
						].join("\n"),
					},
				],
				timestamp: Date.now(),
			});
			lastTestFailed = false; // Only remind once
			return { messages };
		}

		if (!pendingRewind) return;

		const rewind = pendingRewind;
		pendingRewind = null;

		// Rebuild checkpoint map from entries (some may have been pruned)
		// We don't need to do this for the context event since we're operating
		// on the messages array, but we should rebuild the map for future tools.

		// Find the checkpoint message in the array.
		// We look for the checkpoint tool result by scanning for our checkpoint label.
		const messages = event.messages;
		let cutIndex = -1;

		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];
			// Look for the toolResult from our checkpoint call
			if (
				msg.role === "toolResult" &&
				msg.toolName === "checkpoint"
			) {
				const content = Array.isArray(msg.content)
					? msg.content.map((c: any) => c.text || "").join("")
					: String(msg.content || "");
				if (content.includes(`"${rewind.checkpointLabel}"`)) {
					cutIndex = i;
					// Don't break — take the LAST matching checkpoint with this label
					// (in case of re-checkpointing with the same name)
				}
			}
		}

		if (cutIndex === -1) {
			// Checkpoint not found in messages — can't rewind, continue normally
			return;
		}

		// Keep messages 0..cutIndex, then append steering
		const pruned = messages.slice(0, cutIndex + 1);

		const stateJson = JSON.stringify(rewind.checkpointState, null, 2);
		pruned.push({
			role: "user" as const,
			content: [
				{
					type: "text" as const,
					text: [
						`## ⏪ Time Lapse → "${rewind.checkpointLabel}"`,
						"",
						"Everything after this checkpoint has been erased. Here's what was tried:",
						"",
						"### Steering",
						rewind.steering,
						"",
						"### Checkpoint state",
						"```json",
						stateJson,
						"```",
						"",
						"Continue from this checkpoint using the steering above.",
					].join("\n"),
				},
			],
			timestamp: Date.now(),
		});

		pi.appendEntry("weaver-time-lapse-done", {
			checkpointLabel: rewind.checkpointLabel,
			timestamp: Date.now(),
		});

		return { messages: pruned };
	});

	// -----------------------------------------------------------------------
	// Track test failures and edits for system reminders
	// -----------------------------------------------------------------------

	pi.on("tool_result", async (event) => {
		if (!isWeaverMode) return;

		// Track edits
		if (event.toolName === "edit" || event.toolName === "write") {
			editsSinceCheckpoint++;
		}

		// Track bash failures (test runs)
		if (event.toolName === "bash") {
			const details = event.details as { exitCode?: number } | undefined;
			const content = Array.isArray(event.content)
				? event.content.map((c: any) => c.text || "").join("")
				: String(event.content || "");
			const isFail =
				(details?.exitCode && details.exitCode !== 0) ||
				content.includes("FAIL") ||
				content.includes("Error") ||
				content.includes("error:");
			if (isFail) {
				lastTestFailed = true;
			} else {
				lastTestFailed = false;
			}
		}

		// Reset counters on checkpoint or time_lapse
		if (event.toolName === "checkpoint") {
			editsSinceCheckpoint = 0;
			lastTestFailed = false;
		}
		if (event.toolName === "time_lapse") {
			editsSinceCheckpoint = 0;
			lastTestFailed = false;
		}
	});

	// -----------------------------------------------------------------------
	// Block tool calls after time_lapse fires
	// -----------------------------------------------------------------------
	// When time_lapse is called, the model may have batched other tool calls
	// in the same response. Block them — the context pruning on the next
	// LLM call will erase their results anyway.

	pi.on("tool_call", async () => {
		if (!pendingRewind) return;

		return {
			block: true,
			reason:
				"Blocked: time_lapse rewind is pending. " +
				"This tool call will be discarded by the rewind.",
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
		promptSnippet:
			"Save named checkpoint with structured state for time_lapse",
		parameters: Type.Object({
			label: Type.String({
				description:
					"Short name for this checkpoint (e.g., 'ready', 'attempt_2', 'phase_done')",
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
				messageIndex: -1, // Will be resolved in context event if needed
				timestamp: Date.now(),
			};

			checkpoints.set(params.label, data);
			pi.appendEntry("weaver-checkpoint", data);
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
			"Rewind to a named checkpoint, erasing everything after it from context. " +
			"A steering message is injected so you know what was tried and what to do next. " +
			"Use when: test fails after edit, approach is wrong, or phase is complete.",
		promptSnippet:
			"Rewind to checkpoint — erases context after it, injects steering",
		parameters: Type.Object({
			target: Type.String({
				description: "Checkpoint label to rewind to",
			}),
			steering: Type.String({
				description:
					"What you tried, why it failed (or succeeded), what to do next. " +
					"This becomes your context after the rewind.",
			}),
		}),
		async execute(_toolCallId, params) {
			const cp = checkpoints.get(params.target);
			if (!cp) {
				const available = [...checkpoints.keys()].join(", ") || "(none)";
				throw new Error(
					`Checkpoint "${params.target}" not found. Available: ${available}`,
				);
			}

			// Queue the rewind — will be performed in the next `context` event
			pendingRewind = {
				checkpointLabel: params.target,
				steering: params.steering,
				checkpointState: cp.state,
				targetIndex: -1, // Resolved in context event by scanning messages
			};

			pi.appendEntry("weaver-time-lapse-intent", {
				checkpointLabel: params.target,
				steering: params.steering,
				timestamp: Date.now(),
			});

			return {
				content: [
					{
						type: "text",
						text:
							`⏪ Rewinding to "${params.target}". Context will be pruned on the next turn. ` +
							`Do NOT make any more tool calls — they will be blocked and discarded.`,
					},
				],
				details: { target: params.target },
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
		async execute(_toolCallId, params) {
			doneCallCount++;

			if (doneCallCount === 1) {
				const issues = await runVerification(params.summary);

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

	async function runVerification(_summary: string): Promise<string[]> {
		const issues: string[] = [];

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
