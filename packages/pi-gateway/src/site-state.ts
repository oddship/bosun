import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ACTORS_DIR = "actors";
const SHARED_DIR = "shared";

function readJsonFile<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function sortByTimestamp<T extends { ts?: string; id?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const left = a.ts || "";
    const right = b.ts || "";
    if (left !== right) return left.localeCompare(right);
    return (a.id || "").localeCompare(b.id || "");
  });
}

export function safeStateKey(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "actor";
}

export function actorStateDir(stateDir: string, actorId?: string): string {
  const actor = actorId?.trim();
  return actor ? join(stateDir, ACTORS_DIR, safeStateKey(actor)) : join(stateDir, SHARED_DIR);
}

export function partitionTargets(actorId: string | undefined, visibility: string | undefined): Array<string | undefined> {
  const actor = actorId?.trim() || undefined;
  const targets: Array<string | undefined> = [];

  if (visibility !== "private") targets.push(undefined);
  if (actor) targets.push(actor);
  if (targets.length === 0) targets.push(undefined);

  return [...new Set(targets)];
}

export function actorStateFile(stateDir: string, actorId: string | undefined, filename: string): string {
  return join(actorStateDir(stateDir, actorId), filename);
}

export function legacyStateFile(stateDir: string, filename: string): string {
  return join(stateDir, filename);
}

export function partitionedStateFiles(stateDir: string, filename: string): string[] {
  const files: string[] = [];
  const legacy = legacyStateFile(stateDir, filename);
  if (existsSync(legacy)) files.push(legacy);

  const shared = actorStateFile(stateDir, undefined, filename);
  if (existsSync(shared)) files.push(shared);

  const actorsDir = join(stateDir, ACTORS_DIR);
  if (existsSync(actorsDir)) {
    const actorFiles = readdirSync(actorsDir)
      .map((entry) => actorStateFile(stateDir, entry, filename))
      .filter((path) => existsSync(path))
      .sort();
    files.push(...actorFiles);
  }

  return files;
}

export function readPartitionedJsonRecords<T extends { id?: string; ts?: string }>(stateDir: string, filename: string): T[] {
  const byId = new Map<string, T>();
  const unordered: T[] = [];

  for (const path of partitionedStateFiles(stateDir, filename)) {
    const records = readJsonFile<T[]>(path) || [];
    for (const record of records) {
      if (record?.id) {
        byId.set(record.id, record);
      } else {
        unordered.push(record);
      }
    }
  }

  return sortByTimestamp([...unordered, ...byId.values()]);
}
