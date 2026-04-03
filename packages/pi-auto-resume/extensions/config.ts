/**
 * pi-auto-resume configuration loading.
 *
 * Reads `.pi/pi-auto-resume.json` for auto-resume settings.
 * Falls back to sensible defaults when no config file exists.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface AutoResumeConfig {
  /** Whether auto-resume is enabled by default. */
  enabled: boolean;
  /** Cooldown in seconds between auto-resumes (0 = disabled). */
  cooldownSeconds: number;
  /** Message sent to resume the agent after compaction. */
  message: string;
  /**
   * Default context usage % at which to trigger early compaction.
   * Undefined = disabled (pi's default near-full compaction applies).
   * Opt-in: only active when explicitly set.
   */
  compactThreshold?: number;
  /**
   * Per-model overrides for compact threshold.
   * Keys are model ID strings (e.g. "claude-opus-4-6"), values are % thresholds.
   * A model-specific entry takes precedence over compactThreshold.
   */
  compactThresholds?: Record<string, number>;
}

const DEFAULT_MESSAGE =
  "Continue where you left off. If the previous task is complete or you need clarification, just ask.";

const DEFAULTS: AutoResumeConfig = {
  enabled: true,
  cooldownSeconds: 60,
  message: DEFAULT_MESSAGE,
  compactThreshold: undefined,
  compactThresholds: undefined,
};

function isValidThreshold(v: unknown): v is number {
  return typeof v === "number" && v > 0 && v <= 100;
}

function parseThresholds(v: unknown): Record<string, number> | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const result: Record<string, number> = {};
  let hasAny = false;
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    if (isValidThreshold(val)) {
      result[key] = val;
      hasAny = true;
    }
  }
  return hasAny ? result : undefined;
}

/**
 * Resolve the compact threshold for a given model ID.
 * Returns undefined if no threshold applies (feature disabled).
 */
export function resolveCompactThreshold(
  config: AutoResumeConfig,
  modelId: string | undefined,
): number | undefined {
  if (modelId && config.compactThresholds?.[modelId] !== undefined) {
    return config.compactThresholds[modelId];
  }
  return config.compactThreshold;
}

/**
 * Load auto-resume config from `.pi/pi-auto-resume.json` in the given directory.
 * Returns sensible defaults if the file doesn't exist or is invalid.
 */
export function loadConfig(cwd: string): AutoResumeConfig {
  const configPath = path.join(cwd, ".pi", "pi-auto-resume.json");

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULTS };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return {
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULTS.enabled,
      cooldownSeconds:
        typeof raw.cooldownSeconds === "number" && raw.cooldownSeconds >= 0
          ? raw.cooldownSeconds
          : DEFAULTS.cooldownSeconds,
      message: typeof raw.message === "string" && raw.message.trim() ? raw.message : DEFAULTS.message,
      compactThreshold: isValidThreshold(raw.compactThreshold) ? raw.compactThreshold : undefined,
      compactThresholds: parseThresholds(raw.compactThresholds),
    };
  } catch {
    return { ...DEFAULTS };
  }
}
