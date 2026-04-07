import { loadConfig, type AgentsConfig } from "./config.js";
import { resolveAgentFile, loadAgent, type AgentDef } from "./agents.js";
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
export function buildLaunchSpec(cwd: string, options: BuildLaunchSpecOptions = {}): LaunchSpec {
  const config = options.config ?? loadConfig(cwd);
  const agentName = options.agentName ?? config.defaultAgent;
  const agentFile = resolveAgentFile(cwd, config.agentPaths, agentName);

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
