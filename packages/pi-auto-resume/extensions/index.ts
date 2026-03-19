/**
 * pi-auto-resume — Automatically resume after context compaction.
 *
 * After threshold-based compaction the agent goes idle, waiting for user input.
 * This extension sends a follow-up prompt so the agent continues working from
 * the compaction summary's "Next Steps" instead of stopping.
 *
 * Overflow compaction is handled by Pi internally (agent.continue) — this
 * extension detects that case via isIdle() and stays out of the way.
 *
 * Toggle at runtime with /autoresume. Footer shows 🔁 auto when enabled.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config.js";

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let cooldownMs = 60_000;
  let message = "";
  let lastCompactionTime = 0;

  // --- Initialization ---

  pi.on("session_start", async (_event, ctx) => {
    const config = loadConfig(ctx.cwd);
    enabled = config.enabled;
    cooldownMs = config.cooldownSeconds * 1000;
    message = config.message;
    updateStatus(ctx);
  });

  // --- Toggle command ---

  pi.registerCommand("autoresume", {
    description: "Toggle auto-resume after compaction",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      updateStatus(ctx);
      ctx.ui.notify(`Auto-resume ${enabled ? "on" : "off"}`, "info");
    },
  });

  // --- Core: resume after compaction ---

  pi.on("session_compact", async (_event, ctx) => {
    if (!enabled) return;
    if (ctx.hasPendingMessages()) return;
    if (cooldownMs > 0 && Date.now() - lastCompactionTime < cooldownMs) return;
    lastCompactionTime = Date.now();

    // MUST defer: session_compact fires inside _runAutoCompaction, BEFORE
    // the overflow retry's setTimeout(agent.continue, 100ms). Sending now
    // would race with that retry.
    //
    // At 200ms:
    //   Overflow  → agent.continue() already fired at 100ms, isStreaming=true  → skip
    //   Threshold → nothing scheduled, agent is idle                           → send prompt
    setTimeout(() => {
      if (!ctx.isIdle()) return;
      // pi.sendUserMessage is on ExtensionAPI, NOT ExtensionContext.
      // When idle this sends a direct prompt (starts a new turn) — correct.
      pi.sendUserMessage(message);
    }, 200);
  });

  // --- Footer indicator ---

  function updateStatus(ctx: ExtensionContext) {
    ctx.ui.setStatus(
      "auto-resume",
      enabled ? ctx.ui.theme.fg("accent", "🔁 auto") : undefined,
    );
  }
}
