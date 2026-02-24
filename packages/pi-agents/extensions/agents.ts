/**
 * Agent file discovery and parsing.
 *
 * Agents are markdown files with YAML frontmatter in `.pi/agents/`
 * and any extra directories listed in `agentPaths` config.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import matter from "gray-matter";

export interface AgentDef {
  /** Agent identifier (derived from filename if not in frontmatter). */
  name: string;
  /** Brief description of the agent's purpose. */
  description: string;
  /** Model tier name (e.g., "lite", "medium", "high") or raw model string. */
  model?: string;
  /** Thinking level (e.g., "off", "medium", "high"). */
  thinking?: string;
  /** Comma-separated tool names. */
  tools?: string;
  /** Extension/package names for spawn_agent to load (array or comma-separated string). */
  extensions?: string | string[];
  /** Comma-separated skill names to inject. */
  skill?: string;
  /** Markdown body (the persona / system prompt content). */
  body: string;
  /** Raw frontmatter for any extra fields. */
  frontmatter: Record<string, unknown>;
}

/**
 * Scan a directory for agent .md files. Adds names to `agents`, skips duplicates via `seen`.
 */
function scanDir(dir: string, agents: string[], seen: Set<string>): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;

  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith(".md")) {
      const name = file.slice(0, -3);
      if (!seen.has(name)) {
        seen.add(name);
        agents.push(name);
      }
    }
  }
}

/**
 * Discover all available agent names from `.pi/agents/` and `agentPaths`.
 * Standard path has priority (checked first, so its names win deduplication).
 */
export function discoverAgents(cwd: string, agentPaths: string[]): string[] {
  const agents: string[] = [];
  const seen = new Set<string>();

  // Standard path: .pi/agents/
  scanDir(path.join(cwd, ".pi", "agents"), agents, seen);

  // Extra paths from config
  for (const p of agentPaths) {
    const dir = path.isAbsolute(p) ? p : path.join(cwd, p);
    scanDir(dir, agents, seen);
  }

  return agents;
}

/**
 * Find the file path for a named agent. Returns null if not found.
 * Searches `.pi/agents/` first, then `agentPaths` in order.
 */
export function findAgentFile(cwd: string, agentPaths: string[], name: string): string | null {
  // Standard path first
  const standardPath = path.join(cwd, ".pi", "agents", `${name}.md`);
  if (fs.existsSync(standardPath)) return standardPath;

  // Extra paths
  for (const p of agentPaths) {
    const dir = path.isAbsolute(p) ? p : path.join(cwd, p);
    const filePath = path.join(dir, `${name}.md`);
    if (fs.existsSync(filePath)) return filePath;
  }

  return null;
}

/**
 * Load and parse an agent definition from a markdown file.
 * Uses gray-matter for frontmatter parsing.
 */
export function loadAgent(filePath: string): AgentDef {
  const content = fs.readFileSync(filePath, "utf-8");
  const { data, content: body } = matter(content);

  return {
    name: typeof data.name === "string" ? data.name : path.basename(filePath, ".md"),
    description: typeof data.description === "string" ? data.description : "",
    model: typeof data.model === "string" ? data.model : undefined,
    thinking: typeof data.thinking === "string" ? data.thinking : undefined,
    tools: typeof data.tools === "string" ? data.tools : undefined,
    extensions: Array.isArray(data.extensions)
      ? data.extensions
      : typeof data.extensions === "string"
        ? data.extensions
        : undefined,
    skill: typeof data.skill === "string" ? data.skill : undefined,
    body: body.trim(),
    frontmatter: data,
  };
}
