import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createStore, type QMDStore } from "@tobilu/qmd";
import { loadMemoryConfig } from "./config.js";
import type { LoadedMemoryConfig, MemoryRuntime } from "./types.js";

class RuntimeHandle implements MemoryRuntime {
  public readonly cwd: string;
  public readonly config: LoadedMemoryConfig;
  public readonly store: QMDStore;

  public constructor(cwd: string, config: LoadedMemoryConfig, store: QMDStore) {
    this.cwd = cwd;
    this.config = config;
    this.store = store;
  }

  public async ensureReady(): Promise<void> {
    if (!this.config.enabled) {
      throw new Error("Memory is disabled in .pi/pi-memory.json");
    }
  }

  public async close(): Promise<void> {
    await this.store.close();
  }
}

const runtimes = new Map<string, Promise<MemoryRuntime>>();

async function createRuntime(cwd: string): Promise<MemoryRuntime> {
  const config = loadMemoryConfig(cwd);
  if (config.enabled) {
    mkdirSync(dirname(config.resolvedDbPath), { recursive: true });
  }

  const store = await createStore({
    dbPath: config.resolvedDbPath,
    config: config.qmdConfig,
  });

  return new RuntimeHandle(cwd, config, store);
}

export async function getMemoryRuntime(cwd: string): Promise<MemoryRuntime> {
  let runtimePromise = runtimes.get(cwd);
  if (!runtimePromise) {
    runtimePromise = createRuntime(cwd).catch((error) => {
      runtimes.delete(cwd);
      throw error;
    });
    runtimes.set(cwd, runtimePromise);
  }
  return runtimePromise;
}

export async function resetMemoryRuntime(cwd?: string): Promise<void> {
  if (cwd) {
    const runtimePromise = runtimes.get(cwd);
    if (runtimePromise) {
      const runtime = await runtimePromise;
      await runtime.close();
      runtimes.delete(cwd);
    }
    return;
  }

  for (const runtimePromise of runtimes.values()) {
    const runtime = await runtimePromise;
    await runtime.close();
  }
  runtimes.clear();
}
