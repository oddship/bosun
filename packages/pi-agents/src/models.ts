/**
 * Model tier resolution.
 *
 * Resolves tier names (e.g., "lite") to concrete model IDs
 * (e.g., "claude-haiku-4-5") using a models map from agents.json.
 *
 * Pure function — the caller provides the models map (from loadConfig().models)
 * and an optional default. No file I/O, no global state.
 */

const FALLBACK_MODEL = "claude-haiku-4-5";

/**
 * Resolve a model tier name or ID to a concrete model ID.
 *
 * Resolution order:
 * 1. If it looks like a model ID (contains "/" or "-"), return as-is
 * 2. Look up in models map
 * 3. Fall back to defaultModel
 * 4. Fall back to FALLBACK_MODEL
 *
 * @param tierOrId - Tier name ("lite") or model ID ("claude-haiku-4-5")
 * @param models - Map of tier names to model IDs (from loadConfig().models)
 * @param defaultModel - Fallback model when tier is not found
 */
export function resolveModel(
  tierOrId: string | undefined,
  models: Record<string, string>,
  defaultModel?: string,
): string {
  if (!tierOrId) {
    // No tier specified — use default
    if (defaultModel) {
      return resolveModel(defaultModel, models);
    }
    return FALLBACK_MODEL;
  }

  // Looks like a specific model ID already (e.g., "claude-haiku-4-5", "ollama/llama3")
  if (tierOrId.includes("/") || tierOrId.includes("-")) {
    return tierOrId;
  }

  // Look up tier in models map
  const resolved = models[tierOrId];
  if (resolved) {
    return resolved;
  }

  // Tier not found — try the default if different
  if (defaultModel && tierOrId !== defaultModel) {
    return resolveModel(defaultModel, models);
  }

  // Unknown tier with no default — pass through as-is rather than
  // silently substituting a fallback (caller may intend a raw model name)
  return tierOrId;
}
