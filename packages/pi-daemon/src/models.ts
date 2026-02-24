/**
 * Model tier resolution.
 *
 * Resolves tier names (e.g., "lite") to specific model IDs
 * (e.g., "claude-haiku-4-5") using the [models] config map.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { debug } from "./logger.js";

const DEFAULT_MODEL = "claude-haiku-4-5";

let modelMap: Record<string, string> = {};
let defaultModel: string = DEFAULT_MODEL;

/**
 * Load model tier map from config.toml.
 *
 * Parses the [models] section. Simple key = "value" parsing —
 * no full TOML parser needed for this flat section.
 */
export function loadModelConfig(cwd: string): void {
  const configPath = join(cwd, "config.toml");
  if (!existsSync(configPath)) {
    debug("No config.toml found, using default model map");
    return;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const lines = content.split("\n");

    let inModels = false;
    let inDaemon = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Track sections
      if (trimmed.startsWith("[") && !trimmed.startsWith("[[")) {
        inModels = trimmed === "[models]";
        inDaemon = trimmed === "[daemon]";
        continue;
      }

      // Parse [models] section
      if (inModels) {
        const match = trimmed.match(/^(\w+)\s*=\s*"([^"]+)"/);
        if (match) {
          modelMap[match[1]] = match[2];
          debug(`Model tier: ${match[1]} → ${match[2]}`);
        }
      }

      // Parse default_model from [daemon] section
      if (inDaemon) {
        const match = trimmed.match(/^default_model\s*=\s*"([^"]+)"/);
        if (match) {
          defaultModel = match[1];
          debug(`Default model: ${defaultModel}`);
        }
      }
    }
  } catch (err) {
    debug(`Failed to load model config: ${err}`);
  }
}

/**
 * Resolve a model tier name or ID to a concrete model ID.
 *
 * Resolution order:
 * 1. If it looks like a model ID (contains "/" or "-"), return as-is
 * 2. Look up in [models] map
 * 3. Fall back to daemon default_model
 * 4. Fall back to DEFAULT_MODEL
 */
export function resolveModel(tierOrId: string | undefined): string {
  if (!tierOrId) {
    return resolveModel(defaultModel);
  }

  // Looks like a specific model ID already (e.g., "claude-haiku-4-5", "ollama/llama3")
  if (tierOrId.includes("/") || tierOrId.includes("-")) {
    return tierOrId;
  }

  // Look up tier
  const resolved = modelMap[tierOrId];
  if (resolved) {
    return resolved;
  }

  // Tier not found — if it's not the default, try resolving the default
  if (tierOrId !== defaultModel) {
    return resolveModel(defaultModel);
  }

  return DEFAULT_MODEL;
}

/** Get the full model map (for debugging/display). */
export function getModelMap(): Record<string, string> {
  return { ...modelMap };
}
