import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig, type AgentsConfig } from "./config.js";
import { findAgentFile, loadAgent, type AgentDef } from "./agents.js";
import { resolveModel } from "./models.js";

export interface LaunchSpec {
  agentName: string;
  model?: string;
  thinking?: string;
  agentFile: string;
  agent: AgentDef;
}

export interface BuildLaunchSpecOptions {
  config?: AgentsConfig;
  agentName?: string;
}

/**
 * Resolve a Bosun/Pi agent launch into structured startup data.
 *
 * Used by:
 * - top-level Bosun CLI startup (`defaultAgent` path)
 * - child-agent spawn (`agentName` override)
 */
function findFallbackPackageAgent(cwd: string, agentName: string): string | null {
  const packageRoots = [
    path.join(cwd, "packages"),
    path.join(cwd, "node_modules", "bosun", "packages"),
    process.env.BOSUN_PKG ? path.join(process.env.BOSUN_PKG, "packages") : null,
  ].filter((value): value is string => Boolean(value));

  for (const root of packageRoots) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
    for (const entry of fs.readdirSync(root)) {
      const candidate = path.join(root, entry, "agents", `${agentName}.md`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return null;
}

export function buildLaunchSpec(cwd: string, options: BuildLaunchSpecOptions = {}): LaunchSpec {
  const config = options.config ?? loadConfig(cwd);
  const agentName = options.agentName ?? config.defaultAgent;
  const agentFile = findAgentFile(cwd, config.agentPaths, agentName) ?? findFallbackPackageAgent(cwd, agentName);

  if (!agentFile) {
    throw new Error(`Agent '${agentName}' not found in configured agent paths.`);
  }

  const agent = loadAgent(agentFile);

  return {
    agentName,
    model: agent.model ? resolveModel(agent.model, config.models) : undefined,
    thinking: agent.thinking,
    agentFile,
    agent,
  };
}
