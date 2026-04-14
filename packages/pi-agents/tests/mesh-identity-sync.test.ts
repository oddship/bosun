import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProcessBackend } from "../src/backend";
import {
  createHooks,
  setIdentityBackendForTest,
  type IdentityBackend,
} from "../extensions/mesh-identity-sync";
import { createTempDir } from "./temp-dir";

const originalCwd = process.cwd();
const originalAgentName = process.env.PI_AGENT_NAME;
const originalBackendTarget = process.env.PI_BACKEND_TARGET;
const originalBackendSession = process.env.PI_BACKEND_SESSION;

function writeIdentitySyncConfig(dir: string, overrides: Record<string, unknown> = {}): void {
  const piDir = join(dir, ".pi");
  mkdirSync(piDir, { recursive: true });
  writeFileSync(join(piDir, "pi-mesh.json"), JSON.stringify({
    identitySync: {
      enabled: true,
      startupAlign: true,
      meshToTmux: true,
      tmuxToMesh: true,
      pollIntervalMs: 250,
      ...overrides,
    },
  }, null, 2));
}

function makeZmuxIdentityBackend(runtimeNameRef: { value: string }): IdentityBackend {
  const backend = {
    type: "zmux",
    readIdentity: async () => runtimeNameRef.value,
    renameIdentity: async (name: string) => {
      runtimeNameRef.value = name;
    },
  } as unknown as ProcessBackend;

  return {
    available: true,
    backend,
    identityKind: "pane",
    identityTarget: "pane_1",
  };
}

describe("mesh identity sync (backend-neutral)", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    process.env.PI_AGENT_NAME = "";
  });

  afterEach(() => {
    setIdentityBackendForTest(undefined);
    process.chdir(originalCwd);
    process.env.PI_AGENT_NAME = originalAgentName;
    process.env.PI_BACKEND_TARGET = originalBackendTarget;
    process.env.PI_BACKEND_SESSION = originalBackendSession;
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("startup align uses backend rename for zmux-style runtime identity", async () => {
    const tempDir = createTempDir("mesh-identity-sync-");
    tempDirs.push(tempDir);
    writeIdentitySyncConfig(tempDir, { startupAlign: true });
    process.chdir(tempDir);

    const runtimeName = { value: "pane-before" };
    setIdentityBackendForTest(makeZmuxIdentityBackend(runtimeName));

    const hooks = createHooks({} as any);
    const state = {
      agentName: "deckhand-zmux-bosun",
      registered: true,
      hookState: {},
    } as any;

    await hooks.onRegistered?.(state, { hasUI: false } as any);

    expect(runtimeName.value).toBe("deckhand-zmux-bosun");
    expect(process.env.PI_AGENT_NAME).toBe("deckhand-zmux-bosun");
  });

  test("poll tick reads backend identity and renames mesh peer", async () => {
    const tempDir = createTempDir("mesh-identity-sync-");
    tempDirs.push(tempDir);
    writeIdentitySyncConfig(tempDir, { startupAlign: false, pollIntervalMs: 250 });
    process.chdir(tempDir);

    const runtimeName = { value: "deckhand-zmux-bosun" };
    setIdentityBackendForTest(makeZmuxIdentityBackend(runtimeName));

    const hooks = createHooks({} as any);
    const state = {
      agentName: "deckhand-zmux-bosun",
      registered: true,
      hookState: {},
    } as any;

    await hooks.onRegistered?.(state, { hasUI: false } as any);

    runtimeName.value = "deckhand-zmux-renamed";

    const renameCalls: string[] = [];
    await hooks.onPollTick?.(
      state,
      { hasUI: false } as any,
      {
        rename: async (name: string) => {
          renameCalls.push(name);
          state.agentName = name;
          return { success: true } as const;
        },
      } as any,
    );

    expect(renameCalls).toEqual(["deckhand-zmux-renamed"]);
  });

  test("mesh rename stays stable when initial zmux target is name-scoped", async () => {
    const tempDir = createTempDir("mesh-identity-sync-");
    tempDirs.push(tempDir);
    writeIdentitySyncConfig(tempDir, { startupAlign: false, pollIntervalMs: 250 });
    process.chdir(tempDir);

    process.env.PI_BACKEND_TARGET = "deckhand-zmux-old";
    process.env.PI_BACKEND_SESSION = "deckhand-zmux-session";

    const runtimeName = { value: "deckhand-zmux-old" };
    const renameTargets: string[] = [];

    setIdentityBackendForTest({
      available: true,
      identityKind: "pane",
      backend: {
        type: "zmux",
        readIdentity: async (options?: { target?: string }) => {
          const target = options?.target;
          if (target !== "deckhand-zmux-session" && target !== runtimeName.value && target !== "pane_1") {
            return null;
          }
          return runtimeName.value;
        },
        renameIdentity: async (name: string, options?: { target?: string }) => {
          const target = options?.target;
          renameTargets.push(target || "");
          if (target !== "deckhand-zmux-session" && target !== runtimeName.value && target !== "pane_1") {
            throw new Error("stale_target");
          }
          runtimeName.value = name;
        },
      } as unknown as ProcessBackend,
    });

    const hooks = createHooks({} as any);
    const state = {
      agentName: "deckhand-zmux-old",
      registered: true,
      hookState: {},
    } as any;

    await hooks.onRegistered?.(state, { hasUI: false } as any);

    state.agentName = "deckhand-zmux-next";
    await hooks.onRenamed?.(state, { hasUI: false } as any, { success: true } as any, undefined as any);

    state.agentName = "deckhand-zmux-final";
    await hooks.onRenamed?.(state, { hasUI: false } as any, { success: true } as any, undefined as any);

    expect(runtimeName.value).toBe("deckhand-zmux-final");
    expect(renameTargets).toEqual(["deckhand-zmux-session", "deckhand-zmux-session"]);
  });
});
