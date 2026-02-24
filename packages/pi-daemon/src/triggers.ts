/**
 * Trigger state management.
 *
 * Watchers write trigger records to state_dir/triggers.json.
 * The rules engine reads them on heartbeat.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { debug, error } from "./logger.js";
import type { TriggerRecord, TriggersState } from "./types.js";

let triggersFile: string;

export function initTriggers(stateDir: string): void {
  triggersFile = join(stateDir, "triggers.json");
  mkdirSync(dirname(triggersFile), { recursive: true });
}

export function loadTriggers(): TriggersState {
  if (!existsSync(triggersFile)) {
    return { pending: [], last_processed: null };
  }
  try {
    const data = JSON.parse(readFileSync(triggersFile, "utf-8"));
    return {
      pending: Array.isArray(data?.pending) ? data.pending : [],
      last_processed: data?.last_processed || null,
    };
  } catch (err) {
    error(`Failed to load triggers: ${err}`);
    return { pending: [], last_processed: null };
  }
}

function saveTriggers(triggers: TriggersState): void {
  const tmpFile = triggersFile + ".tmp";
  writeFileSync(tmpFile, JSON.stringify(triggers, null, 2));
  renameSync(tmpFile, triggersFile);
}

/** Add a trigger record (deduplicates by path). */
export function addTrigger(watcher: string, path: string, event: "add" | "change"): void {
  const triggers = loadTriggers();

  // Dedupe: remove existing trigger for same path
  triggers.pending = triggers.pending.filter((t) => t.path !== path);

  triggers.pending.push({
    path,
    event,
    timestamp: new Date().toISOString(),
    watcher,
  });

  saveTriggers(triggers);
  debug(`Trigger added: ${watcher} → ${path} (${event})`);
}

/** Remove triggers for paths that have been processed. */
export function clearProcessedTriggers(paths: string[]): void {
  const triggers = loadTriggers();
  triggers.pending = triggers.pending.filter((t) => !paths.includes(t.path));
  triggers.last_processed = new Date().toISOString();
  saveTriggers(triggers);
}

/** Check if there are pending triggers from a specific watcher. */
export function hasTrigger(watcherName: string): boolean {
  const triggers = loadTriggers();
  return triggers.pending.some((t) => t.watcher === watcherName);
}

/** Get all pending triggers from a specific watcher. */
export function getTriggers(watcherName: string): TriggerRecord[] {
  const triggers = loadTriggers();
  return triggers.pending.filter((t) => t.watcher === watcherName);
}

/** Check if any pending trigger from a watcher is older than N minutes. */
export function hasStaleTrigger(watcherName: string, minutes: number): boolean {
  const triggers = loadTriggers();
  const cutoff = new Date(Date.now() - minutes * 60_000);
  return triggers.pending.some(
    (t) => t.watcher === watcherName && new Date(t.timestamp) < cutoff,
  );
}
