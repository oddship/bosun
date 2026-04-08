import type { DocumentNotFound, HybridQueryResult, SearchResult } from "@tobilu/qmd";
import {
  formatDocumentResult,
  formatHybridSearchResult,
  formatKeywordSearchResult,
  formatMultiGetResult,
  formatNotFound,
  formatSearchResults,
  formatStatusResult,
} from "./format.js";
import { getMemoryRuntime } from "./store.js";
import type {
  LoadedMemoryConfig,
  MemoryGetArgs,
  MemoryGetResult,
  MemoryMultiGetArgs,
  MemoryNotFoundResult,
  MemorySearchArgs,
  MemorySearchResult,
  MemorySearchResultItem,
  MemoryStatusResult,
} from "./types.js";

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function hybridSearchDisabledError(config: LoadedMemoryConfig): Error & { code: string } {
  return Object.assign(
    new Error(
      `Hybrid memory search is disabled by project config (memory.allow_hybrid_search=false). Available options: use mode='keyword', omit mode to use the default ('${config.defaultMode}'), or enable memory.allow_hybrid_search=true in config.toml.`,
    ),
    { code: "hybrid_search_disabled" },
  );
}

function rankAndTrim(results: MemorySearchResultItem[], limit: number, minScore: number): MemorySearchResultItem[] {
  return results
    .filter((result) => result.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function selectCollections(
  runtimeCollections: Record<string, { includeByDefault?: boolean }>,
  requested?: string[],
): string[] | undefined {
  if (requested && requested.length > 0) return unique(requested);
  const defaults = Object.entries(runtimeCollections)
    .filter(([, collection]) => collection.includeByDefault)
    .map(([name]) => name);
  return defaults.length > 0 ? defaults : undefined;
}

async function keywordSearchAcrossCollections(
  cwd: string,
  args: Required<Pick<MemorySearchArgs, "query" | "limit" | "minScore">> & Pick<MemorySearchArgs, "collections">,
): Promise<MemorySearchResultItem[]> {
  const runtime = await getMemoryRuntime(cwd);
  await runtime.ensureReady();

  const maxLines = runtime.config.formatting.snippetMaxLines;
  const targetCollections = selectCollections(runtime.config.resolvedCollections, args.collections);

  if (!targetCollections || targetCollections.length === 0) {
    const results = await runtime.store.searchLex(args.query, { limit: args.limit });
    return rankAndTrim(results.map((result) => formatKeywordSearchResult(result, maxLines)), args.limit, args.minScore);
  }

  const perCollection = await Promise.all(
    targetCollections.map(async (collection) => runtime.store.searchLex(args.query, { limit: args.limit, collection })),
  );

  const merged = new Map<string, SearchResult>();
  for (const result of perCollection.flat()) {
    const existing = merged.get(result.filepath);
    if (!existing || result.score > existing.score) {
      merged.set(result.filepath, result);
    }
  }

  return rankAndTrim([...merged.values()].map((result) => formatKeywordSearchResult(result, maxLines)), args.limit, args.minScore);
}

async function hybridSearch(
  cwd: string,
  args: Required<Pick<MemorySearchArgs, "query" | "limit" | "minScore">> & Pick<MemorySearchArgs, "collections" | "intent">,
): Promise<MemorySearchResultItem[]> {
  const runtime = await getMemoryRuntime(cwd);
  await runtime.ensureReady();

  const collections = selectCollections(runtime.config.resolvedCollections, args.collections);
  const results = await runtime.store.search({
    query: args.query,
    collections,
    intent: args.intent,
    limit: args.limit,
    minScore: args.minScore,
    rerank: runtime.config.searchDefaults.rerank,
  });

  return results.map((result: HybridQueryResult) => formatHybridSearchResult(result, runtime.config.formatting.snippetMaxLines));
}

export async function executeMemorySearch(cwd: string, args: MemorySearchArgs): Promise<MemorySearchResult> {
  const runtime = await getMemoryRuntime(cwd);
  const mode = args.mode || runtime.config.defaultMode;
  const limit = args.limit || runtime.config.defaultLimit;
  const minScore = args.minScore ?? runtime.config.searchDefaults.minScore;

  if (mode === "hybrid" && !runtime.config.allowHybridSearch) {
    throw hybridSearchDisabledError(runtime.config);
  }

  const results = mode === "keyword"
    ? await keywordSearchAcrossCollections(cwd, {
        query: args.query,
        collections: args.collections,
        limit,
        minScore,
      })
    : await hybridSearch(cwd, {
        query: args.query,
        collections: args.collections,
        limit,
        minScore,
        intent: args.intent,
      });

  return formatSearchResults(args.query, mode, args.collections, results);
}

export async function executeMemoryGet(cwd: string, args: MemoryGetArgs): Promise<MemoryGetResult | MemoryNotFoundResult> {
  const runtime = await getMemoryRuntime(cwd);
  await runtime.ensureReady();

  const doc = await runtime.store.get(args.id, { includeBody: false });
  if ("error" in doc) {
    return formatNotFound(args.id, doc as DocumentNotFound);
  }

  const maxLines = args.maxLines;
  const fromLine = args.fromLine;
  const full = args.full ?? (typeof maxLines !== "number" && typeof fromLine !== "number");
  const content = await runtime.store.getDocumentBody(args.id, {
    fromLine,
    maxLines: full ? undefined : (maxLines || runtime.config.formatting.defaultGetMaxLines),
  });

  return formatDocumentResult(
    args.id,
    doc,
    content || "",
    full,
    fromLine,
    full ? undefined : (maxLines || runtime.config.formatting.defaultGetMaxLines),
  );
}

export async function executeMemoryMultiGet(cwd: string, args: MemoryMultiGetArgs) {
  const runtime = await getMemoryRuntime(cwd);
  await runtime.ensureReady();

  const result = await runtime.store.multiGet(args.pattern, {
    includeBody: true,
    maxBytes: args.maxBytes || runtime.config.formatting.multiGetMaxBytes,
  });

  return formatMultiGetResult(args.pattern, result.docs, result.errors);
}

export async function executeMemoryStatus(cwd: string): Promise<MemoryStatusResult> {
  const runtime = await getMemoryRuntime(cwd);
  await runtime.ensureReady();

  const status = await runtime.store.getStatus();
  const health = await runtime.store.getIndexHealth();
  return formatStatusResult(runtime.config, status, health);
}
