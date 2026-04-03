/**
 * pi-auto-resume — Automatically resume after context compaction,
 * with optional early compaction based on context usage thresholds.
 *
 * After compaction (threshold, manual /compact, or overflow) the agent
 * normally goes idle. This extension sends a follow-up prompt so the agent
 * continues working from the compaction summary's next steps.
 *
 * Opt-in early compaction: when compact_threshold or per-model thresholds
 * are configured, triggers compaction when context usage exceeds the %
 * threshold — before quality degrades in long contexts.
 *
 * Hooks session_compact which fires for ALL compaction types. For overflow,
 * Pi already retries internally via agent.continue() — the deferred isIdle()
 * check at 200ms detects that and skips.
 *
 * Toggle at runtime with /autoresume. Footer shows 🔁 auto when enabled.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { type AutoResumeConfig, loadConfig, resolveCompactThreshold } from "./config.js";

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let cooldownMs = 60_000;
  let message = "";
  let lastCompactionTime = 0;
  let config: AutoResumeConfig;

  // --- Initialization ---

  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig(ctx.cwd);
    enabled = config.enabled;
    cooldownMs = config.cooldownSeconds * 1000;
    message = config.message;
    updateStatus(ctx);
  });

  // Update footer when model changes (threshold is per-model)
  pi.on("model_select", async (_event, ctx) => {
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

  // --- Early compaction on context threshold ---

  let compactingFromThreshold = false;
  let lastThresholdCompactTime = 0;

  pi.on("turn_end", async (_event, ctx) => {
    if (!config) return;
    if (compactingFromThreshold) return;

    // After a threshold-triggered compaction, skip one cycle to avoid looping
    // if compaction doesn't free enough context (keepRecentTokens still above %).
    if (lastThresholdCompactTime > 0 && Date.now() - lastThresholdCompactTime < 30_000) return;

    const modelId = ctx.model?.id;
    const threshold = resolveCompactThreshold(config, modelId);
    if (threshold === undefined) return;

    const usage = ctx.getContextUsage();
    if (!usage || usage.percent === null) return;

    if (usage.percent >= threshold) {
      compactingFromThreshold = true;
      ctx.compact({
        onComplete: () => {
          compactingFromThreshold = false;
          lastThresholdCompactTime = Date.now();
        },
        onError: () => {
          compactingFromThreshold = false;
          lastThresholdCompactTime = Date.now();
        },
      });
    }
  });

  // --- Footer indicator ---

  function updateStatus(ctx: ExtensionContext) {
    const parts: string[] = [];
    if (enabled) parts.push("🔁 auto");

    if (config) {
      const threshold = resolveCompactThreshold(config, ctx.model?.id);
      if (threshold !== undefined) parts.push(`📏 ${threshold}%`);
    }

    ctx.ui.setStatus(
      "auto-resume",
      parts.length > 0 ? ctx.ui.theme.fg("accent", parts.join(" ")) : undefined,
    );
  }
}
