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
	timestamp: number;
}

interface PendingRewind {
	checkpointLabel: string;
	steering: string;
	checkpointState: Record<string, unknown>;
}

const WEAVER_TOOLS = ["checkpoint", "time_lapse", "done"];

export default function weaver(pi: ExtensionAPI) {
	// Skip ALL registration when not the weaver agent.
	// Loading pi-weaver's registerTool/hooks interferes with Pi's TUI tool
	// rendering even when the tools are disabled. Until that Pi bug is fixed,
	// only the weaver agent should load this extension.
	if (process.env.PI_AGENT !== "weaver") {
		// Register only the /weaver command so users see a helpful message
		pi.registerCommand("weaver", {
			description: "Weaver tools (only available in weaver agent)",
			handler: async (_args, ctx) => {
				ctx.ui.notify(
					"Weaver tools are only available in the weaver agent. " +
					"Spawn a weaver: spawn_agent({ agent: 'weaver', task: '...' })",
					"warn",
				);
			},
		});
		return;
	}

	const checkpoints = new Map<string, CheckpointData>();
	let isWeaverMode = false;
	// Starts enabled for weaver agent. /weaver off can disable mid-session.
	// Non-weaver agents never reach here (early return above).
	let isEnabled = true;

	// When set, the next `context` event will prune messages and inject steering
	let pendingRewind: PendingRewind | null = null;

	// Track whether the last test/bash failed — used to inject reminders
	let lastTestFailed = false;
	// Track how many edits happened since last checkpoint or time_lapse
	let editsSinceCheckpoint = 0;

	// -----------------------------------------------------------------------
	// Toggle helpers
	// -----------------------------------------------------------------------

	function setWeaverEnabled(enabled: boolean, ctx: ExtensionContext) {
		if (isEnabled === enabled) return;
		isEnabled = enabled;

		if (enabled) {
			// Add weaver tools back to active set
			const current = new Set(pi.getActiveTools().map((t) => t.name));
			for (const name of WEAVER_TOOLS) current.add(name);
			pi.setActiveTools([...current]);
		} else {
			// Remove weaver tools from active set
			const filtered = pi.getActiveTools()
				.map((t) => t.name)
				.filter((n) => !WEAVER_TOOLS.includes(n));
			pi.setActiveTools(filtered);
		}

		pi.appendEntry("weaver-toggle", { enabled, timestamp: Date.now() });
		updateStatus(ctx);
	}

	// -----------------------------------------------------------------------
	// Command: /weaver [on|off|toggle]
	// -----------------------------------------------------------------------

	pi.registerCommand("weaver", {
		description: "Toggle weaver on/off (checkpoint, time_lapse, done tools)",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim().toLowerCase();
			if (arg === "on") {
				setWeaverEnabled(true, ctx);
			} else if (arg === "off") {
				setWeaverEnabled(false, ctx);
			} else {
				// toggle
				setWeaverEnabled(!isEnabled, ctx);
			}
			const state = isEnabled ? "ON 🕸️" : "OFF";
			ctx.ui.notify(`Weaver ${state}`, "info");
		},
	});

	// -----------------------------------------------------------------------
	// Restore state on session start/resume
	// -----------------------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		checkpoints.clear();
		pendingRewind = null;
		lastTestFailed = false;
		editsSinceCheckpoint = 0;

		for (const entry of ctx.sessionManager.getEntries()) {
			const e = entry as any;
			if (e.type === "custom" && e.customType === "weaver-checkpoint") {
				const data = e.data as CheckpointData;
				checkpoints.set(data.label, data);
			}
			if (e.type === "custom" && e.customType === "weaver-active") {
				isWeaverMode = true;
			}
			if (e.type === "custom" && e.customType === "weaver-toggle") {
				isEnabled = (e.data as { enabled: boolean }).enabled;
			}
		}

		// Apply tool visibility based on restored toggle state
		if (!isEnabled) {
			const filtered = pi.getActiveTools()
				.map((t) => t.name)
				.filter((n) => !WEAVER_TOOLS.includes(n));
			pi.setActiveTools(filtered);
		}

		if (isWeaverMode) updateStatus(ctx);
	});

	// -----------------------------------------------------------------------
	// Inject weaver system prompt
	// -----------------------------------------------------------------------

	pi.on("before_agent_start", async (event) => {
		if (!isEnabled) return;

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
		if (!isEnabled) return;

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

		// Find the checkpoint's toolResult in the message array by matching
		// on structured details (not content text — that's fragile).
		// The checkpoint tool sets details = { label, state, entryId, timestamp }.
		const messages = event.messages;
		let cutIndex = -1;

		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];
			if (
				msg.role === "toolResult" &&
				msg.toolName === "checkpoint" &&
				(msg as any).details?.label === rewind.checkpointLabel
			) {
				cutIndex = i;
				// Don't break — take the LAST matching checkpoint with this label
				// (in case of re-checkpointing with the same name)
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
		if (!isWeaverMode || !isEnabled) return;

		// Track edits
		if (event.toolName === "edit" || event.toolName === "write") {
			editsSinceCheckpoint++;
		}

		// Track bash failures — only count as test failure if we've made edits
		// (orientation failures like "apt-get not found" shouldn't trigger reminders)
		// Bash signals failure via isError (thrown error sets isError: true on result),
		// not via details.exitCode (BashToolDetails only has truncation info).
		if (event.toolName === "bash" && event.isError && editsSinceCheckpoint > 0) {
			lastTestFailed = true;
			// Don't clear lastTestFailed on success — only checkpoint/time_lapse clear it.
			// This prevents `echo "test"` between a failure and the next LLM call
			// from clearing the flag.
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
		if (!isEnabled || !pendingRewind) return;

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
		if (!isEnabled) {
			ctx.ui.setStatus("weaver", undefined);
			return;
		}
		if (!isWeaverMode) return;
		const cpCount = checkpoints.size;
		if (cpCount > 0) {
			const labels = [...checkpoints.keys()].slice(-3).join(", ");
			ctx.ui.setStatus(
				"weaver",
				ctx.ui.theme.fg("accent", `🕸️ ${cpCount} checkpoints: ${labels}`),
			);
		} else {
			ctx.ui.setStatus("weaver", ctx.ui.theme.fg("muted", "🕸️ weaver"));
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
			"Signal task completion. Call after verifying your work passes all tests. " +
			"Include a summary of what you accomplished.",
		promptSnippet: "Signal task completion with summary",
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
			pi.appendEntry("weaver-done", {
				summary: params.summary,
				state: params.state,
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
				},
			};
		},
	});
}
