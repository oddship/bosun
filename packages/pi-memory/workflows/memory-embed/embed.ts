/**
 * Memory embedding script — generates vector embeddings for semantic search.
 *
 * Runs as a daemon script workflow. Loads the pi-memory config, opens the QMD
 * store, runs update() to sync documents, then embed() to generate vectors.
 *
 * GPU acceleration is opt-in via `gpu: true` in config. setupGpu() must run
 * before qmd is imported so env vars are set before llama.cpp build detection.
 * We use a dynamic import for qmd to guarantee this ordering.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { setupGpu } from "./setup-gpu.js";

const BOSUN_ROOT = process.env.BOSUN_ROOT || process.cwd();

interface MemoryCollectionConfig {
  path: string;
  pattern?: string;
  ignore?: string[];
  includeByDefault?: boolean;
}

interface MemoryFileConfig {
  enabled?: boolean;
  gpu?: boolean;
  dbPath?: string;
  collections?: Record<string, MemoryCollectionConfig>;
}

function loadConfig(): { gpu: boolean; dbPath: string; collections: Record<string, MemoryCollectionConfig> } {
  const configPath = join(BOSUN_ROOT, ".pi", "pi-memory.json");

  const defaults = {
    gpu: false,
    dbPath: ".bosun-home/.cache/qmd/index.sqlite",
    collections: {
      sessions: { path: "workspace/users", pattern: "**/*.md", includeByDefault: true },
      docs: { path: "docs", pattern: "**/*.md", includeByDefault: true },
      skills: { path: ".pi/skills", pattern: "**/*.md", includeByDefault: false },
      agents: { path: ".pi/agents", pattern: "**/*.md", includeByDefault: false },
    } as Record<string, MemoryCollectionConfig>,
  };

  if (!existsSync(configPath)) return defaults;

  try {
    const raw: MemoryFileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    if (raw.enabled === false) {
      console.log("[memory-embed] Memory disabled in config, skipping");
      process.exit(0);
    }
    return {
      gpu: raw.gpu === true,
      dbPath: raw.dbPath || defaults.dbPath,
      collections: raw.collections || defaults.collections,
    };
  } catch (err) {
    console.warn(`[memory-embed] Failed to parse ${configPath}, using defaults:`, err);
    return defaults;
  }
}

function resolvePath(input: string): string {
  return isAbsolute(input) ? input : resolve(BOSUN_ROOT, input);
}

async function main() {
  // Step 0: Load config and configure GPU env vars BEFORE importing qmd.
  // qmd triggers llama.cpp build detection at import time, so Vulkan env
  // vars must be set first.
  const config = loadConfig();
  setupGpu(config.gpu);

  // Dynamic import guarantees qmd loads AFTER setupGpu has set Vulkan env vars
  const { createStore } = await import("@tobilu/qmd");
  type QMDStore = Awaited<ReturnType<typeof createStore>>;

  const dbPath = resolvePath(config.dbPath);

  console.log(`[memory-embed] DB: ${dbPath}`);
  console.log(`[memory-embed] Collections: ${Object.keys(config.collections).join(", ")}`);

  const collectionConfig: Record<string, { path: string; pattern?: string; ignore?: string[] }> = {};
  for (const [name, col] of Object.entries(config.collections)) {
    collectionConfig[name] = {
      path: resolvePath(col.path),
      pattern: col.pattern || "**/*.md",
      ignore: col.ignore,
    };
  }

  let store: QMDStore | null = null;
  try {
    store = await createStore({
      dbPath,
      config: { collections: collectionConfig },
    });

    // Step 1: Update document index
    console.log("[memory-embed] Updating document index...");
    const updateResult = await store.update({
      onProgress: (info: { current: number; total: number; collection: string }) => {
        if (info.current % 50 === 0 || info.current === info.total) {
          console.log(`[memory-embed] Indexing: ${info.current}/${info.total} (${info.collection})`);
        }
      },
    });
    console.log(
      `[memory-embed] Update: ${updateResult.indexed} new, ${updateResult.updated} updated, ` +
        `${updateResult.unchanged} unchanged, ${updateResult.removed} removed`,
    );

    // Step 2: Check if embedding is needed
    const health = await store.getIndexHealth();
    if (health.needsEmbedding === 0) {
      console.log("[memory-embed] All documents already embedded, nothing to do");
      await store.close();
      process.exit(0);
    }

    console.log(`[memory-embed] ${health.needsEmbedding} documents need embedding (${health.totalDocs} total)`);

    // Step 3: Generate embeddings
    console.log("[memory-embed] Generating embeddings (this may take a while on first run)...");
    const embedResult = await store.embed({
      onProgress: (info: { chunksEmbedded: number; totalChunks: number; bytesProcessed: number; totalBytes: number; errors: number }) => {
        if (info.chunksEmbedded % 10 === 0 || info.chunksEmbedded === info.totalChunks) {
          console.log(
            `[memory-embed] Embedding: ${info.chunksEmbedded}/${info.totalChunks} chunks ` +
              `(${(info.bytesProcessed / 1024).toFixed(0)}/${(info.totalBytes / 1024).toFixed(0)} KB, ` +
              `${info.errors} errors)`,
          );
        }
      },
    });

    console.log(
      `[memory-embed] Done: ${embedResult.docsProcessed} docs, ${embedResult.chunksEmbedded} chunks embedded, ` +
        `${embedResult.errors} errors in ${(embedResult.durationMs / 1000).toFixed(1)}s`,
    );

    // Step 4: Verify
    const status = await store.getStatus();
    console.log(
      `[memory-embed] Final: ${status.totalDocuments} docs, ` +
        `${status.needsEmbedding} need embedding, ` +
        `vectorIndex=${status.hasVectorIndex}`,
    );

    await store.close();
  } catch (err) {
    console.error("[memory-embed] Failed:", err);
    if (store) await store.close().catch(() => {});
    process.exit(1);
  }
}

main();
