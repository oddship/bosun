import type { MemoryCollectionConfig, MemoryConfig } from "./types.js";

export const DEFAULT_MEMORY_COLLECTIONS: Record<string, MemoryCollectionConfig> = {
  sessions: {
    path: "workspace/users",
    pattern: "**/*.md",
    includeByDefault: true,
  },
  docs: {
    path: "docs",
    pattern: "**/*.md",
    includeByDefault: true,
  },
  skills: {
    path: ".pi/skills",
    pattern: "**/*.md",
    includeByDefault: false,
  },
  agents: {
    path: ".pi/agents",
    pattern: "**/*.md",
    includeByDefault: false,
  },
};

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true,
  dbPath: ".bosun-home/.cache/qmd/index.sqlite",
  autoUpdateOnOpen: true,
  defaultMode: "keyword",
  defaultLimit: 5,
  globalContext: undefined,
  collections: DEFAULT_MEMORY_COLLECTIONS,
  searchDefaults: {
    minScore: 0,
    rerank: true,
  },
  formatting: {
    snippetMaxLines: 12,
    multiGetMaxBytes: 20_480,
    defaultGetMaxLines: 80,
  },
};
