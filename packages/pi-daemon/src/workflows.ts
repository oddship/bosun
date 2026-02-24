/**
 * Workflow discovery and configuration.
 *
 * Discovers workflow directories from three locations (in priority order):
 * packages, .pi/workflows, workspace/workflows.
 * Later sources override earlier ones by workflow name.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { info, debug, error } from "./logger.js";

// --- Types ---

export interface WorkflowConfig {
  /** Workflow name (from directory name or config). */
  name: string;
  /** Description. */
  description: string;
  /** "agent" (spawn LLM) or "script" (run command). */
  type: "agent" | "script";
  /** Source directory for this workflow. */
  dir: string;
  /** Discovery source. */
  source: "package" | "repo" | "user";

  /** Trigger configuration. */
  trigger: {
    schedule?: string;
    watcher?: string;
    debounce_ms?: number;
    manual?: boolean;
    startup?: boolean;
  };

  /** Agent configuration (type = "agent"). */
  agent?: {
    model?: string;
    prompt: string;
    systemPromptFile?: string;
  };

  /** Script configuration (type = "script"). */
  script?: {
    command: string;
  };

  /** Retry configuration. */
  retry: {
    max_attempts: number;
    feedback: boolean;
  };

  /** Validator file paths (relative to workflow dir). */
  validators: {
    input?: string;
    output?: string;
  };

  /** Timeout in minutes. */
  timeout_minutes: number;
}

// --- TOML parsing (minimal, flat sections) ---

interface TomlSection {
  [key: string]: string | number | boolean;
}

function parseSimpleToml(content: string): Record<string, TomlSection> {
  const result: Record<string, TomlSection> = { "": {} };
  let currentSection = "";

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Section header
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!result[currentSection]) result[currentSection] = {};
      continue;
    }

    // Key = value
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value: string | number | boolean = kvMatch[2].trim();

      // Parse value types
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      else if (!isNaN(Number(value))) value = Number(value);
      // Multi-line strings (triple quotes)
      else if (value.startsWith('"""') || value.startsWith("'''")) {
        value = value.slice(3);
        if (value.endsWith('"""') || value.endsWith("'''")) {
          value = value.slice(0, -3);
        }
      }

      result[currentSection][key] = value;
    }
  }

  return result;
}

// --- Workflow parsing ---

function parseWorkflowDir(dir: string, source: "package" | "repo" | "user"): WorkflowConfig | null {
  const configPath = join(dir, "config.toml");
  if (!existsSync(configPath)) {
    debug(`No config.toml in ${dir}, skipping`);
    return null;
  }

  try {
    const raw = parseSimpleToml(readFileSync(configPath, "utf-8"));
    const workflow = raw["workflow"] || {};
    const trigger = raw["trigger"] || {};
    const agent = raw["agent"] || {};
    const script = raw["script"] || {};
    const retry = raw["retry"] || {};
    const validators = raw["validators"] || {};
    const timeout = raw["timeout"] || {};

    const name = (workflow.name as string) || basename(dir);
    const type = (workflow.type as string) === "script" ? "script" : "agent";

    // Check agent.md exists for agent workflows
    const agentMdPath = join(dir, "agent.md");
    const hasAgentMd = existsSync(agentMdPath);

    const config: WorkflowConfig = {
      name,
      description: (workflow.description as string) || "",
      type,
      dir,
      source,

      trigger: {
        schedule: trigger.schedule as string | undefined,
        watcher: trigger.watcher as string | undefined,
        debounce_ms: typeof trigger.debounce_ms === "number" ? trigger.debounce_ms : undefined,
        manual: trigger.manual === true,
        startup: trigger.startup === true,
      },

      retry: {
        max_attempts: typeof retry.max_attempts === "number" ? retry.max_attempts : 2,
        feedback: retry.feedback !== false, // default true
      },

      validators: {
        input: validators.input ? String(validators.input) : undefined,
        output: validators.output ? String(validators.output) : undefined,
      },

      timeout_minutes: typeof timeout.minutes === "number" ? timeout.minutes : 10,
    };

    if (type === "agent") {
      config.agent = {
        model: agent.model as string | undefined,
        prompt: (agent.prompt as string) || "",
        systemPromptFile: hasAgentMd ? agentMdPath : undefined,
      };
    } else {
      config.script = {
        command: (script.command as string) || "",
      };
    }

    return config;
  } catch (err) {
    error(`Failed to parse workflow at ${dir}: ${err}`);
    return null;
  }
}

function scanWorkflowsIn(baseDir: string, source: "package" | "repo" | "user"): WorkflowConfig[] {
  if (!existsSync(baseDir)) return [];

  const workflows: WorkflowConfig[] = [];

  try {
    const entries = readdirSync(baseDir);
    for (const entry of entries) {
      const dir = join(baseDir, entry);
      if (!statSync(dir).isDirectory()) continue;

      const wf = parseWorkflowDir(dir, source);
      if (wf) {
        debug(`Discovered workflow: ${wf.name} (${source}) at ${dir}`);
        workflows.push(wf);
      }
    }
  } catch (err) {
    debug(`Failed to scan ${baseDir}: ${err}`);
  }

  return workflows;
}

// --- Discovery ---

/**
 * Discover all workflows from three locations.
 * Later sources override earlier ones (by workflow name).
 */
export function discoverWorkflows(cwd: string): WorkflowConfig[] {
  const byName = new Map<string, WorkflowConfig>();

  // 1. Packages — scan packages/*/workflows/
  const packagesDir = join(cwd, "packages");
  if (existsSync(packagesDir)) {
    try {
      for (const pkg of readdirSync(packagesDir)) {
        const wfDir = join(packagesDir, pkg, "workflows");
        for (const wf of scanWorkflowsIn(wfDir, "package")) {
          byName.set(wf.name, wf);
        }
      }
    } catch {}
  }

  // 2. Repo — .pi/workflows/
  const repoDir = join(cwd, ".pi", "workflows");
  for (const wf of scanWorkflowsIn(repoDir, "repo")) {
    if (byName.has(wf.name)) {
      info(`Workflow override: ${wf.name} (repo overrides package)`);
      // Merge: repo config overrides, but keep package defaults for missing fields
      const base = byName.get(wf.name)!;
      byName.set(wf.name, mergeWorkflows(base, wf));
    } else {
      byName.set(wf.name, wf);
    }
  }

  // 3. User — workspace/workflows/
  const userDir = join(cwd, "workspace", "workflows");
  for (const wf of scanWorkflowsIn(userDir, "user")) {
    if (byName.has(wf.name)) {
      info(`Workflow override: ${wf.name} (user overrides ${byName.get(wf.name)!.source})`);
      const base = byName.get(wf.name)!;
      byName.set(wf.name, mergeWorkflows(base, wf));
    } else {
      byName.set(wf.name, wf);
    }
  }

  const workflows = Array.from(byName.values());
  info(`Discovered ${workflows.length} workflow(s)`);
  return workflows;
}

/**
 * Merge two workflow configs. Override takes precedence,
 * but falls back to base for unset fields.
 */
function mergeWorkflows(base: WorkflowConfig, override: WorkflowConfig): WorkflowConfig {
  return {
    name: override.name,
    description: override.description || base.description,
    type: override.type || base.type,
    dir: override.dir,
    source: override.source,

    trigger: {
      schedule: override.trigger.schedule ?? base.trigger.schedule,
      watcher: override.trigger.watcher ?? base.trigger.watcher,
      debounce_ms: override.trigger.debounce_ms ?? base.trigger.debounce_ms,
      manual: override.trigger.manual || base.trigger.manual,
      startup: override.trigger.startup || base.trigger.startup,
    },

    agent: override.agent || base.agent,
    script: override.script || base.script,

    retry: {
      max_attempts: override.retry.max_attempts ?? base.retry.max_attempts,
      feedback: override.retry.feedback ?? base.retry.feedback,
    },

    validators: {
      input: override.validators.input ?? base.validators.input,
      output: override.validators.output ?? base.validators.output,
    },

    timeout_minutes: override.timeout_minutes ?? base.timeout_minutes,
  };
}

/**
 * Derive watcher configs from workflows that have watcher triggers.
 */
export function deriveWatchers(workflows: WorkflowConfig[]): Array<{
  name: string;
  pattern: string;
  debounce_ms: number;
}> {
  return workflows
    .filter((wf) => wf.trigger.watcher)
    .map((wf) => ({
      name: `wf-${wf.name}`,
      pattern: wf.trigger.watcher!,
      debounce_ms: wf.trigger.debounce_ms ?? 5000,
    }));
}

/**
 * Derive rule configs from workflows.
 */
export function deriveRules(workflows: WorkflowConfig[]): Array<{
  name: string;
  workflow: string;
  trigger?: string;
  schedule?: string;
  stale_minutes?: number;
}> {
  return workflows
    .filter((wf) => wf.trigger.schedule || wf.trigger.watcher)
    .map((wf) => ({
      name: wf.name,
      workflow: wf.name,
      trigger: wf.trigger.watcher ? `wf-${wf.name}` : undefined,
      schedule: wf.trigger.schedule,
    }));
}
