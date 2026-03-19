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
}

const DEFAULT_MESSAGE =
  "Continue where you left off. If the previous task is complete or you need clarification, just ask.";

const DEFAULTS: AutoResumeConfig = {
  enabled: true,
  cooldownSeconds: 60,
  message: DEFAULT_MESSAGE,
};

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
    };
  } catch {
    return { ...DEFAULTS };
  }
}
