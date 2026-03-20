export interface ParsedModel {
  provider: string;
  modelId: string;
}

/**
 * Parse a model string like "anthropic/claude-sonnet-4-5" into { provider, modelId }.
 * Handles bare names like "claude-sonnet-4-5" or "gpt-5" via auto-detection.
 */
export function parseModelString(model: string): ParsedModel {
  const trimmed = model.trim();
  if (!trimmed) throw new Error("Model name must be provided");

  const parts = trimmed.split("/");

  // Explicit provider prefix
  if (parts.length >= 2) {
    const first = parts[0].toLowerCase();
    if (first === "bedrock") {
      // Map "bedrock" → "amazon-bedrock" (pi-ai SDK convention)
      // Strip optional "converse/" prefix from model ID
      let modelId = parts.slice(1).join("/");
      if (modelId.startsWith("converse/")) {
        modelId = modelId.slice("converse/".length);
      }
      return { provider: "amazon-bedrock", modelId };
    }
    if (["anthropic", "openai"].includes(first)) {
      return { provider: first, modelId: parts.slice(1).join("/") };
    }
  }

  // Auto-detect provider from bare model name
  const lower = trimmed.toLowerCase();
  if (lower.includes("claude") || lower.includes("anthropic")) {
    return { provider: "anthropic", modelId: trimmed };
  }
  if (
    lower.startsWith("gpt") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4") ||
    lower.includes("openai")
  ) {
    return { provider: "openai", modelId: trimmed };
  }

  // Default to anthropic for unknown models
  return { provider: "anthropic", modelId: trimmed };
}

/**
 * Map reasoning effort strings to pi-ai thinking levels.
 * Returns undefined for no reasoning.
 */
export function mapReasoningEffort(
  effort: string | undefined,
): "low" | "medium" | "high" | undefined {
  if (!effort) return undefined;
  switch (effort.toLowerCase()) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
      return "high";
    default:
      return undefined;
  }
}

/**
 * Get API key with provider-aware selection.
 *
 * Priority:
 * 1. LLM_API_KEY (universal override)
 * 2. Provider-specific key (ANTHROPIC_API_KEY, OPENAI_API_KEY)
 * 3. Fallback to any available key
 *
 * Returns null for bedrock (uses AWS credentials).
 */
export function getApiKey(model?: string): string | null {
  // Priority 1: Universal override
  const llmKey = process.env.LLM_API_KEY;
  if (llmKey) return llmKey;

  // Priority 2: Provider-specific
  if (model) {
    const { provider } = parseModelString(model);
    if (provider === "amazon-bedrock") return null;
    if (provider === "anthropic") {
      const key = process.env.ANTHROPIC_API_KEY;
      if (key) return key;
    }
    if (provider === "openai") {
      const key = process.env.OPENAI_API_KEY;
      if (key) return key;
    }
  }

  // Priority 3: Fallback
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;

  throw new Error(
    "No LLM API key found. Please set one of: LLM_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY",
  );
}
