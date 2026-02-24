/**
 * pi-agents — Agent identity, model tiers, and spawn_agent tool for Pi.
 *
 * Reads PI_AGENT env var to determine which agent persona to load.
 * Injects the agent's markdown body as a system prompt prefix.
 * Writes agent_identity to session JSONL for daemon filtering.
 * Registers the spawn_agent tool for launching sub-agents in tmux.
 *
 * Set PI_AGENT=none to skip persona injection entirely.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig, type AgentsConfig } from "./config.js";
import { findAgentFile, loadAgent } from "./agents.js";
import { registerSpawnAgent } from "./spawn.js";

export default function (pi: ExtensionAPI) {
  const agentName = process.env.PI_AGENT || "none";

  // Config cache — loaded once per cwd on first access.
  let cachedConfig: AgentsConfig | null = null;
  let cachedCwd: string | null = null;

  function getConfig(cwd: string): AgentsConfig {
    if (cachedCwd !== cwd || !cachedConfig) {
      cachedConfig = loadConfig(cwd);
      cachedCwd = cwd;
    }
    return cachedConfig;
  }

  // --- Identity injection ---

  // Inject agent persona (markdown body) as system prompt prefix.
  pi.on("before_agent_start", async (event, ctx) => {
    if (agentName === "none") return {};

    const config = getConfig(ctx.cwd);
    const agentFile = findAgentFile(ctx.cwd, config.agentPaths, agentName);
    if (!agentFile) return {};

    const agent = loadAgent(agentFile);
    if (!agent.body) return {};

    return {
      systemPrompt: agent.body + "\n\n" + event.systemPrompt,
    };
  });

  // Write agent identity to session JSONL + set PI_AGENT_NAME fallback.
  pi.on("session_start", async () => {
    if (agentName === "none") return;

    // Belt-and-suspenders: sandbox.sh sets PI_AGENT_NAME, but if running
    // without sandbox (e.g., just start-unsandboxed), set it from PI_AGENT.
    if (!process.env.PI_AGENT_NAME) {
      process.env.PI_AGENT_NAME = agentName;
    }

    // Persist identity for daemon session filtering.
    // Creates: {"type":"custom","customType":"agent_identity","data":{"agent":"bosun"}}
    pi.appendEntry("agent_identity", { agent: agentName });
  });

  // --- spawn_agent tool ---

  registerSpawnAgent(pi, getConfig);
}
