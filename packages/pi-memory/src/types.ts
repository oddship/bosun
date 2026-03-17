import type { CollectionConfig, QMDStore } from "@tobilu/qmd";

export interface MemoryCollectionConfig {
  path: string;
  pattern?: string;
  ignore?: string[];
  includeByDefault?: boolean;
  context?: Record<string, string>;
}

export interface MemorySearchDefaults {
  minScore: number;
  rerank: boolean;
}

export interface MemoryFormattingConfig {
  snippetMaxLines: number;
  multiGetMaxBytes: number;
  defaultGetMaxLines: number;
}

export interface MemoryConfig {
  enabled: boolean;
  dbPath: string;
  autoUpdateOnOpen: boolean;
  defaultMode: "keyword" | "hybrid";
  defaultLimit: number;
  globalContext?: string;
  collections: Record<string, MemoryCollectionConfig>;
  searchDefaults: MemorySearchDefaults;
  formatting: MemoryFormattingConfig;
}

export interface LoadedMemoryConfig extends MemoryConfig {
  cwd: string;
  resolvedDbPath: string;
  resolvedCollections: Record<string, MemoryCollectionConfig>;
  qmdConfig: CollectionConfig;
}

export interface MemoryRuntime {
  cwd: string;
  config: LoadedMemoryConfig;
  store: QMDStore;
  ensureReady(): Promise<void>;
  close(): Promise<void>;
}

export interface MemorySearchArgs {
  query: string;
  mode?: "keyword" | "hybrid";
  collections?: string[];
  limit?: number;
  minScore?: number;
  intent?: string;
}

export interface MemoryGetArgs {
  id: string;
  full?: boolean;
  fromLine?: number;
  maxLines?: number;
}

export interface MemoryMultiGetArgs {
  pattern: string;
  maxBytes?: number;
}

export interface MemorySearchResultItem {
  docid: string;
  title: string;
  file: string;
  filepath?: string;
  collection?: string;
  score: number;
  snippet: string;
  mode: "keyword" | "hybrid";
}

export interface MemorySearchResult {
  query: string;
  mode: "keyword" | "hybrid";
  collections?: string[];
  results: MemorySearchResultItem[];
}

export interface MemoryGetResult {
  id: string;
  docid: string;
  title: string;
  file: string;
  filepath: string;
  collection: string;
  content: string;
  full: boolean;
  fromLine?: number;
  maxLines?: number;
  truncated: boolean;
}

export interface MemoryNotFoundResult {
  id: string;
  error: "not_found";
  similarFiles: string[];
}

export interface MemoryMultiGetResultItem {
  id: string;
  title?: string;
  file: string;
  filepath?: string;
  content?: string;
  skipped: boolean;
  skipReason?: string;
}

export interface MemoryMultiGetResult {
  pattern: string;
  docs: MemoryMultiGetResultItem[];
  errors: string[];
}

export interface MemoryStatusResult {
  enabled: boolean;
  autoUpdateOnOpen: boolean;
  dbPath: string;
  defaultMode: "keyword" | "hybrid";
  defaultLimit: number;
  totalDocuments: number;
  needsEmbedding: number;
  hasVectorIndex: boolean;
  health: {
    totalDocs: number;
    needsEmbedding: number;
    daysStale: number | null;
  };
  collections: Array<{
    name: string;
    path: string;
    pattern: string;
    includeByDefault: boolean;
    documents: number;
    lastUpdated: string | null;
  }>;
}
