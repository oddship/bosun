import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { CollectionConfig } from "@tobilu/qmd";
import { DEFAULT_MEMORY_CONFIG } from "./defaults.js";
import type { LoadedMemoryConfig, MemoryCollectionConfig, MemoryConfig } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback?: string): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? strings : undefined;
}

function mergeCollectionConfig(base: MemoryCollectionConfig, value: unknown): MemoryCollectionConfig {
  if (!isObject(value)) return { ...base };

  return {
    path: asString(value.path, base.path) || base.path,
    pattern: asString(value.pattern, base.pattern) || base.pattern,
    ignore: asStringArray(value.ignore) || base.ignore,
    includeByDefault: asBoolean(value.includeByDefault, base.includeByDefault ?? false),
    context: isObject(value.context)
      ? Object.fromEntries(Object.entries(value.context).filter(([, v]) => typeof v === "string")) as Record<string, string>
      : base.context,
  };
}

function resolvePath(cwd: string, input: string): string {
  return isAbsolute(input) ? input : resolve(cwd, input);
}

function buildQmdConfig(cwd: string, collections: Record<string, MemoryCollectionConfig>, globalContext?: string): CollectionConfig {
  return {
    global_context: globalContext,
    collections: Object.fromEntries(
      Object.entries(collections).map(([name, collection]) => [
        name,
        {
          path: resolvePath(cwd, collection.path),
          pattern: collection.pattern || "**/*.md",
          ignore: collection.ignore,
          context: collection.context,
          includeByDefault: collection.includeByDefault,
        },
      ]),
    ),
  };
}

export function loadMemoryConfig(cwd: string): LoadedMemoryConfig {
  const configPath = join(cwd, ".pi", "pi-memory.json");
  let raw: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
      if (isObject(parsed)) raw = parsed;
    } catch (error) {
      console.warn(`Warning: Failed to parse ${configPath}; using memory defaults.`, error);
      raw = {};
    }
  }

  const rawCollections = isObject(raw.collections) ? raw.collections : {};
  const mergedCollections = Object.fromEntries(
    Object.entries(DEFAULT_MEMORY_CONFIG.collections).map(([name, defaults]) => [
      name,
      mergeCollectionConfig(defaults, rawCollections[name]),
    ]),
  ) as Record<string, MemoryCollectionConfig>;

  for (const [name, value] of Object.entries(rawCollections)) {
    if (!(name in mergedCollections) && isObject(value) && typeof value.path === "string") {
      mergedCollections[name] = mergeCollectionConfig({ path: value.path }, value);
    }
  }

  const config: MemoryConfig = {
    enabled: asBoolean(raw.enabled, DEFAULT_MEMORY_CONFIG.enabled),
    gpu: asBoolean(raw.gpu, DEFAULT_MEMORY_CONFIG.gpu),
    dbPath: asString(raw.dbPath, DEFAULT_MEMORY_CONFIG.dbPath) || DEFAULT_MEMORY_CONFIG.dbPath,
    autoUpdateOnOpen: asBoolean(raw.autoUpdateOnOpen, DEFAULT_MEMORY_CONFIG.autoUpdateOnOpen),
    defaultMode: raw.defaultMode === "hybrid" ? "hybrid" : DEFAULT_MEMORY_CONFIG.defaultMode,
    defaultLimit: asNumber(raw.defaultLimit, DEFAULT_MEMORY_CONFIG.defaultLimit),
    globalContext: asString(raw.globalContext, DEFAULT_MEMORY_CONFIG.globalContext),
    collections: mergedCollections,
    searchDefaults: {
      minScore: asNumber(isObject(raw.searchDefaults) ? raw.searchDefaults.minScore : undefined, DEFAULT_MEMORY_CONFIG.searchDefaults.minScore),
      rerank: asBoolean(isObject(raw.searchDefaults) ? raw.searchDefaults.rerank : undefined, DEFAULT_MEMORY_CONFIG.searchDefaults.rerank),
    },
    formatting: {
      snippetMaxLines: asNumber(isObject(raw.formatting) ? raw.formatting.snippetMaxLines : undefined, DEFAULT_MEMORY_CONFIG.formatting.snippetMaxLines),
      multiGetMaxBytes: asNumber(isObject(raw.formatting) ? raw.formatting.multiGetMaxBytes : undefined, DEFAULT_MEMORY_CONFIG.formatting.multiGetMaxBytes),
      defaultGetMaxLines: asNumber(isObject(raw.formatting) ? raw.formatting.defaultGetMaxLines : undefined, DEFAULT_MEMORY_CONFIG.formatting.defaultGetMaxLines),
    },
  };

  const qmdConfig = buildQmdConfig(cwd, config.collections, config.globalContext);

  return {
    ...config,
    cwd,
    resolvedDbPath: resolvePath(cwd, config.dbPath),
    resolvedCollections: Object.fromEntries(
      Object.entries(config.collections).map(([name, collection]) => [
        name,
        { ...collection, path: resolvePath(cwd, collection.path) },
      ]),
    ),
    qmdConfig,
  };
}
