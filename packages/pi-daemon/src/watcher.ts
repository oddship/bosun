/**
 * File watchers using chokidar.
 *
 * Watchers set trigger flags in triggers.json via addTrigger().
 * The rules engine checks triggers on heartbeat.
 */

import { watch, type FSWatcher } from "chokidar";
import { join } from "node:path";
import { info, debug, error } from "./logger.js";
import { addTrigger } from "./triggers.js";
import type { WatcherConfig } from "./types.js";

const watchers = new Map<string, FSWatcher>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function setupWatchers(watcherConfigs: WatcherConfig[], rootDir: string): void {
  for (const config of watcherConfigs) {
    const pattern = join(rootDir, config.pattern);
    info(`Setting up watcher: ${config.name} → ${config.pattern}`);

    const watcher = watch(pattern, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: config.debounce_ms || 2000,
        pollInterval: 100,
      },
    });

    watcher.on("add", (path) => handleChange(config, path, "add"));
    watcher.on("change", (path) => handleChange(config, path, "change"));
    watcher.on("error", (err) => error(`Watcher error (${config.name}): ${err}`));

    watchers.set(config.name, watcher);
  }
}

function handleChange(
  config: WatcherConfig,
  path: string,
  event: "add" | "change",
): void {
  const key = `${config.name}:${path}`;
  const debounceMs = config.debounce_ms || 5000;

  // Debounce
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    key,
    setTimeout(() => {
      debug(`File ${event}: ${path}`);
      addTrigger(config.name, path, event);
      debounceTimers.delete(key);
    }, debounceMs),
  );
}

export function closeWatchers(): void {
  for (const [name, watcher] of watchers) {
    debug(`Closing watcher: ${name}`);
    watcher.close();
  }
  watchers.clear();

  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
}
