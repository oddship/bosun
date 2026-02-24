/**
 * Daemon configuration loading from .pi/daemon.json.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DaemonConfig, WatcherConfig, RuleConfig } from "./types.js";

const DEFAULTS: DaemonConfig = {
  enabled: false,
  handlers_dir: "scripts/daemon/handlers",
  heartbeat_interval_seconds: 60,
  state_dir: ".bosun-daemon",
  log_level: "info",
  watchers: [],
  rules: [],
};

export function loadDaemonConfig(cwd: string): DaemonConfig {
  const configPath = join(cwd, ".pi", "daemon.json");

  if (!existsSync(configPath)) {
    return { ...DEFAULTS, watchers: [], rules: [] };
  }

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    return {
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULTS.enabled,
      handlers_dir: typeof raw.handlers_dir === "string" ? raw.handlers_dir : DEFAULTS.handlers_dir,
      heartbeat_interval_seconds:
        typeof raw.heartbeat_interval_seconds === "number"
          ? raw.heartbeat_interval_seconds
          : DEFAULTS.heartbeat_interval_seconds,
      state_dir: typeof raw.state_dir === "string" ? raw.state_dir : DEFAULTS.state_dir,
      log_level:
        typeof raw.log_level === "string" && ["debug", "info", "warn", "error"].includes(raw.log_level)
          ? (raw.log_level as DaemonConfig["log_level"])
          : DEFAULTS.log_level,
      watchers: Array.isArray(raw.watchers) ? parseWatchers(raw.watchers) : [],
      rules: Array.isArray(raw.rules) ? parseRules(raw.rules) : [],
    };
  } catch {
    return { ...DEFAULTS, watchers: [], rules: [] };
  }
}

function parseWatchers(raw: unknown[]): WatcherConfig[] {
  return raw
    .filter((w): w is Record<string, unknown> => typeof w === "object" && w !== null)
    .filter((w) => typeof w.name === "string" && typeof w.pattern === "string")
    .map((w) => ({
      name: w.name as string,
      pattern: w.pattern as string,
      debounce_ms: typeof w.debounce_ms === "number" ? w.debounce_ms : 5000,
    }));
}

function parseRules(raw: unknown[]): RuleConfig[] {
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .filter((r) => typeof r.name === "string" && typeof r.handler === "string")
    .map((r) => ({
      name: r.name as string,
      handler: r.handler as string,
      trigger: typeof r.trigger === "string" ? r.trigger : undefined,
      schedule: typeof r.schedule === "string" ? r.schedule : undefined,
      stale_minutes: typeof r.stale_minutes === "number" ? r.stale_minutes : undefined,
    }));
}
