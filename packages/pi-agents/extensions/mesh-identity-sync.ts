/**
 * Mesh Identity Sync — lifecycle hooks for pi-mesh.
 *
 * Keeps runtime identity (PI_AGENT_NAME) in sync across
 * Pi UI, mesh peer registry, and the selected runtime backend.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type {
  MeshConfig,
  MeshLifecycleHooks,
  MeshState,
} from "pi-mesh/types.js";
import { isInTmux } from "../../pi-tmux/core.ts";
import { createBackendContract, type BackendEntityKind, type ProcessBackend } from "../src/backend.js";
import { loadConfig } from "../src/config.js";

// =============================================================================
// Identity Sync Config
// =============================================================================

interface IdentitySyncConfig {
  enabled: boolean;
  startupAlign: boolean;
  meshToTmux: boolean;
  tmuxToMesh: boolean;
  pollIntervalMs: number;
}

const DEFAULTS: IdentitySyncConfig = {
  enabled: false,
  startupAlign: true,
  meshToTmux: true,
  tmuxToMesh: true,
  pollIntervalMs: 2000,
};

function loadIdentitySyncConfig(): IdentitySyncConfig {
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, ".pi", "pi-mesh.json");
    if (existsSync(candidate)) {
      try {
        const raw = JSON.parse(readFileSync(candidate, "utf-8"));
        const sync = raw?.identitySync;
        if (sync && typeof sync === "object") {
          return {
            enabled: typeof sync.enabled === "boolean" ? sync.enabled : DEFAULTS.enabled,
            startupAlign: typeof sync.startupAlign === "boolean" ? sync.startupAlign : DEFAULTS.startupAlign,
            meshToTmux: typeof sync.meshToTmux === "boolean" ? sync.meshToTmux : DEFAULTS.meshToTmux,
            tmuxToMesh: typeof sync.tmuxToMesh === "boolean" ? sync.tmuxToMesh : DEFAULTS.tmuxToMesh,
            pollIntervalMs: typeof sync.pollIntervalMs === "number" && sync.pollIntervalMs >= 250
              ? sync.pollIntervalMs
              : DEFAULTS.pollIntervalMs,
          };
        }
      } catch {
        // malformed config -> defaults
      }
      break;
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return { ...DEFAULTS };
}

// =============================================================================
// Runtime Identity Helpers
// =============================================================================

function setRuntimeName(name: string): void {
  process.env.PI_AGENT_NAME = name;
}

function updateRuntimeIdentityUI(ctx: ExtensionContext, name: string): void {
  if (!ctx.hasUI) return;
  const emoji = process.env.PI_AGENT_EMOJI || "🤖";
  ctx.ui.setTitle(`pi — ${name}`);
  ctx.ui.setStatus("agent", `${emoji} ${name}`);
}

function refreshRuntimeIdentity(state: MeshState, ctx: ExtensionContext): void {
  setRuntimeName(state.agentName);
  updateRuntimeIdentityUI(ctx, state.agentName);
}

// =============================================================================
// Hook State
// =============================================================================

interface IdentitySyncState {
  lastObservedRuntimeName?: string;
  suppressRuntimeRenameUntil: number;
}

function getSyncState(state: MeshState): IdentitySyncState {
  if (!state.hookState) state.hookState = {};
  if (!state.hookState._identitySync) {
    state.hookState._identitySync = {
      suppressRuntimeRenameUntil: 0,
    };
  }
  return state.hookState._identitySync as IdentitySyncState;
}

// =============================================================================
// Backend Adapter
// =============================================================================

export interface IdentityBackend {
  backend?: ProcessBackend;
  identityKind?: BackendEntityKind;
  identityTarget?: string;
  resolveIdentityTarget?: () => string | undefined;
  available: boolean;
  reason?: string;
}

let identityBackendOverride: IdentityBackend | undefined;

export function setIdentityBackendForTest(backend?: IdentityBackend): void {
  identityBackendOverride = backend;
}

function resolveIdentityBackend(): IdentityBackend {
  if (identityBackendOverride) return identityBackendOverride;
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  try {
    const backend = createBackendContract({
      cwd,
      backend: config.backend,
    });

    if (backend.type === "tmux" && !isInTmux()) {
      return {
        backend,
        available: false,
        reason: "tmux backend not active in this process",
      };
    }

    const identityKind: BackendEntityKind = backend.type === "tmux" ? "window" : "pane";

    return {
      backend,
      identityKind,
      resolveIdentityTarget: () => {
        if (backend.type === "zmux") {
          return process.env.PI_BACKEND_SESSION
            || process.env.PI_BACKEND_TARGET
            || process.env.PI_AGENT_NAME
            || process.env.PI_AGENT
            || undefined;
        }

        return process.env.PI_BACKEND_TARGET
          || process.env.PI_AGENT_NAME
          || process.env.PI_AGENT
          || undefined;
      },
      available: true,
    };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveIdentityTarget(identityBackend: IdentityBackend): string | undefined {
  if (identityBackend.resolveIdentityTarget) {
    return identityBackend.resolveIdentityTarget();
  }

  if (identityBackend.identityTarget) {
    return identityBackend.identityTarget;
  }

  if (identityBackend.backend?.type === "zmux") {
    return process.env.PI_BACKEND_SESSION
      || process.env.PI_BACKEND_TARGET
      || process.env.PI_AGENT_NAME
      || process.env.PI_AGENT
      || undefined;
  }

  return process.env.PI_BACKEND_TARGET
    || process.env.PI_AGENT_NAME
    || process.env.PI_AGENT
    || undefined;
}

async function readRuntimeIdentityName(identityBackend: IdentityBackend): Promise<string | null> {
  if (!identityBackend.available || !identityBackend.backend) return null;
  try {
    const target = resolveIdentityTarget(identityBackend);
    return await identityBackend.backend.readIdentity({
      kind: identityBackend.identityKind,
      target,
    });
  } catch {
    return null;
  }
}

async function renameRuntimeIdentity(identityBackend: IdentityBackend, name: string): Promise<boolean> {
  if (!identityBackend.available || !identityBackend.backend) return false;
  try {
    const target = resolveIdentityTarget(identityBackend);
    await identityBackend.backend.renameIdentity(name, {
      kind: identityBackend.identityKind,
      target,
    });
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Sync Logic
// =============================================================================

async function syncRuntimeNameToAgentName(
  syncState: IdentitySyncState,
  syncConfig: IdentitySyncConfig,
  identityBackend: IdentityBackend,
  name: string,
): Promise<void> {
  if (!syncConfig.meshToTmux) return;

  const renamed = await renameRuntimeIdentity(identityBackend, name);
  if (!renamed) return;

  const observedName = await readRuntimeIdentityName(identityBackend);
  syncState.lastObservedRuntimeName = observedName ?? name;
  syncState.suppressRuntimeRenameUntil = Date.now() + syncConfig.pollIntervalMs * 2;
}

function notifyIdentitySyncFailure(
  ctx: ExtensionContext,
  runtimeName: string,
  error: string | undefined,
): void {
  if (!ctx.hasUI) return;
  if (error === "same_name") return;

  const message =
    error === "invalid_name"
      ? `Runtime name "${runtimeName}" is not a valid mesh name.`
      : error === "name_taken"
        ? `Runtime name "${runtimeName}" is already taken on the mesh.`
        : `Couldn't sync runtime name "${runtimeName}" to the mesh.`;

  ctx.ui.notify(message, "warning");
}

// =============================================================================
// Hook Entry Point
// =============================================================================

export function createHooks(_meshConfig: MeshConfig): MeshLifecycleHooks {
  const syncConfig = loadIdentitySyncConfig();
  const identityBackend = resolveIdentityBackend();

  if (!syncConfig.enabled) {
    return {
      onRegistered(state, ctx) {
        refreshRuntimeIdentity(state, ctx);
      },
    };
  }

  return {
    async onRegistered(state, ctx) {
      refreshRuntimeIdentity(state, ctx);

      if (!identityBackend.available) return;

      const syncState = getSyncState(state);
      const currentName = await readRuntimeIdentityName(identityBackend);
      syncState.lastObservedRuntimeName = currentName ?? state.agentName;

      if (syncConfig.startupAlign && currentName && currentName !== state.agentName) {
        await syncRuntimeNameToAgentName(syncState, syncConfig, identityBackend, state.agentName);
      }

      if (!state.hookState) state.hookState = {};
      state.hookState.pollIntervalMs = syncConfig.pollIntervalMs;
    },

    async onRenamed(state, ctx, _result, actions) {
      refreshRuntimeIdentity(state, ctx);

      if (actions?.sendMessage) {
        actions.sendMessage(
          {
            customType: "identity-sync",
            content: `Your mesh identity has been updated. You are now "${state.agentName}". Use this name when referring to yourself.`,
            display: `🔄 Renamed to **${state.agentName}**`,
          },
          { deliverAs: "nextTurn" },
        );
      }

      if (!identityBackend.available) return;

      const syncState = getSyncState(state);
      await syncRuntimeNameToAgentName(syncState, syncConfig, identityBackend, state.agentName);
    },

    async onPollTick(state, ctx, actions) {
      if (!syncConfig.tmuxToMesh || !identityBackend.available || !state.registered) return;

      const syncState = getSyncState(state);
      if (Date.now() < syncState.suppressRuntimeRenameUntil) return;

      const runtimeName = await readRuntimeIdentityName(identityBackend);
      if (!runtimeName) return;
      if (runtimeName === syncState.lastObservedRuntimeName) return;

      syncState.lastObservedRuntimeName = runtimeName;
      if (runtimeName === state.agentName) return;

      const renameResult = await actions.rename(runtimeName);
      if (!renameResult.success) {
        notifyIdentitySyncFailure(ctx, runtimeName, renameResult.error);

        if (renameResult.error !== "same_name") {
          await syncRuntimeNameToAgentName(syncState, syncConfig, identityBackend, state.agentName);
        }
      }
    },

    onShutdown(_state) {
      // no-op
    },
  };
}
