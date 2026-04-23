import type { DocumentNotFound, DocumentResult, HybridQueryResult, MultiGetResult, SearchResult } from "@tobilu/qmd";
import type {
  LoadedMemoryConfig,
  MemoryGetResult,
  MemoryMultiGetResult,
  MemoryMultiGetResultItem,
  MemoryNotFoundResult,
  MemorySearchResult,
  MemorySearchResultItem,
  MemoryStatusResult,
} from "./types.js";

function trimLines(text: string, maxLines: number): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  return normalized.split("\n").slice(0, maxLines).join("\n");
}

function keywordSnippet(result: SearchResult, maxLines: number): string {
  const body = typeof result.body === "string" ? result.body : "";
  const snippet = trimLines(body, maxLines);
  if (snippet) return snippet;
  return result.context || "";
}

function hybridSnippet(result: HybridQueryResult, maxLines: number): string {
  const snippet = trimLines(result.bestChunk || result.body || "", maxLines);
  if (snippet) return snippet;
  return result.context || "";
}

export function formatKeywordSearchResult(result: SearchResult, maxLines: number): MemorySearchResultItem {
  return {
    docid: `#${result.docid}`,
    title: result.title,
    file: result.displayPath,
    filepath: result.filepath,
    collection: result.collectionName,
    score: result.score,
    snippet: keywordSnippet(result, maxLines),
    mode: "keyword",
  };
}

export function formatHybridSearchResult(result: HybridQueryResult, maxLines: number): MemorySearchResultItem {
  const collection = result.displayPath.match(/^qmd:\/\/([^/]+)\//)?.[1];

  return {
    docid: `#${result.docid}`,
    title: result.title,
    file: result.displayPath,
    filepath: result.file,
    collection,
    score: result.score,
    snippet: hybridSnippet(result, maxLines),
    mode: "hybrid",
  };
}

export function formatSearchResults(
  query: string,
  mode: "keyword" | "hybrid",
  collections: string[] | undefined,
  results: MemorySearchResultItem[],
): MemorySearchResult {
  return {
    query,
    mode,
    collections: collections && collections.length > 0 ? collections : undefined,
    results,
  };
}

export function formatDocumentResult(
  id: string,
  doc: DocumentResult,
  content: string,
  full: boolean,
  fromLine: number | undefined,
  maxLines: number | undefined,
): MemoryGetResult {
  return {
    id,
    docid: `#${doc.docid}`,
    title: doc.title,
    file: doc.displayPath,
    filepath: doc.filepath,
    collection: doc.collectionName,
    content,
    full,
    fromLine,
    maxLines,
    truncated: typeof maxLines === "number",
  };
}

export function formatNotFound(id: string, result: DocumentNotFound): MemoryNotFoundResult {
  return {
    id,
    error: result.error,
    similarFiles: result.similarFiles,
  };
}

export function formatMultiGetResult(pattern: string, docs: MultiGetResult[], errors: string[]): MemoryMultiGetResult {
  const formattedDocs: MemoryMultiGetResultItem[] = docs.map((entry) => {
    if (entry.skipped) {
      return {
        id: entry.doc.displayPath,
        file: entry.doc.displayPath,
        filepath: entry.doc.filepath,
        skipped: true,
        skipReason: entry.skipReason,
      };
    }

    return {
      id: `#${entry.doc.docid}`,
      title: entry.doc.title,
      file: entry.doc.displayPath,
      filepath: entry.doc.filepath,
      content: entry.doc.body,
      skipped: false,
    };
  });

  return {
    pattern,
    docs: formattedDocs,
    errors,
  };
}

export function formatStatusResult(
  config: LoadedMemoryConfig,
  status: {
    totalDocuments: number;
    needsEmbedding: number;
    hasVectorIndex: boolean;
    collections: Array<{ name: string; path: string | null; pattern: string | null; documents: number; lastUpdated: string }>;
  },
  health: { totalDocs: number; needsEmbedding: number; daysStale: number | null },
): MemoryStatusResult {
  const indexedByName = new Map(status.collections.map((collection) => [collection.name, collection]));

  return {
    enabled: config.enabled,
    gpu: config.gpu,
    allowHybridSearch: config.allowHybridSearch,
    dbPath: config.resolvedDbPath,
    defaultMode: config.defaultMode,
    defaultLimit: config.defaultLimit,
    totalDocuments: status.totalDocuments,
    needsEmbedding: status.needsEmbedding,
    hasVectorIndex: status.hasVectorIndex,
    health,
    collections: Object.entries(config.resolvedCollections).map(([name, collection]) => {
      const indexed = indexedByName.get(name);
      return {
        name,
        path: collection.path,
        pattern: collection.pattern || "**/*.md",
        includeByDefault: collection.includeByDefault ?? false,
        documents: indexed?.documents ?? 0,
        lastUpdated: indexed?.lastUpdated ?? null,
      };
    }),
  };
}
