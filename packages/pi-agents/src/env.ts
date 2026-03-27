/**
 * Agent environment variable builder.
 *
 * Canonical source for PI_AGENT_* env vars set when spawning agents.
 * Used by both spawnAgent() (tmux) and the daemon's agent-runner (headless).
 */

export interface AgentEnvOptions {
  /** Agent persona name (e.g., "lite", "verify"). */
  agent: string;
  /** Runtime instance name (e.g., "lite", "lite-2", window name). */
  name: string;
  /** Parent agent that spawned this one. */
  parentAgent?: string;
  /** Emoji for TUI display. */
  emoji?: string;
}

/**
 * Build the standard agent environment variables.
 *
 * These are set on every spawned agent process — interactive (tmux)
 * or headless (pi --print). Keep this as the single source of truth
 * so new vars are picked up everywhere.
 */
export function buildAgentEnv(options: AgentEnvOptions): Record<string, string> {
  return {
    PI_AGENT: options.agent,
    PI_AGENT_NAME: options.name,
    PI_PARENT_AGENT: options.parentAgent
      || process.env.PI_AGENT_NAME
      || process.env.PI_AGENT
      || "agent",
    PI_AGENT_EMOJI: options.emoji || "🤖",
  };
}
