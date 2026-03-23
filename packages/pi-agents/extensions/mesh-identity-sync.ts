/**
 * Mesh Identity Sync — lifecycle hooks for pi-mesh.
 *
 * Keeps the agent's runtime identity (PI_AGENT_NAME) in sync across
 * three surfaces: Pi UI, mesh peer registry, and tmux window name.
 *
 * Configured via the `identitySync` key in .pi/pi-mesh.json:
 *
 *   {
 *     "identitySync": {
 *       "enabled": true,
 *       "startupAlign": true,
 *       "meshToTmux": true,
 *       "tmuxToMesh": true,
 *       "pollIntervalMs": 2000
 *     }
 *   }
 *
 * Loaded by pi-mesh via hooksModule in the same config file.
 */

import { execFile } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type {
  MeshConfig,
  MeshState,
  MeshLifecycleHooks,
  HookActions,
} from "pi-mesh/types.js";
import type { RenameResult } from "pi-mesh/registry.js";

const execFileAsync = promisify(execFile);

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
  // Walk up to find .pi/pi-mesh.json
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, ".pi", "pi-mesh.json");
    if (existsSync(candidate)) {
      try {
        const raw = JSON.parse(readFileSync(candidate, "utf-8"));
        const is = raw?.identitySync;
        if (is && typeof is === "object") {
          return {
            enabled: typeof is.enabled === "boolean" ? is.enabled : DEFAULTS.enabled,
            startupAlign: typeof is.startupAlign === "boolean" ? is.startupAlign : DEFAULTS.startupAlign,
            meshToTmux: typeof is.meshToTmux === "boolean" ? is.meshToTmux : DEFAULTS.meshToTmux,
            tmuxToMesh: typeof is.tmuxToMesh === "boolean" ? is.tmuxToMesh : DEFAULTS.tmuxToMesh,
            pollIntervalMs:
              typeof is.pollIntervalMs === "number" && is.pollIntervalMs >= 250
                ? is.pollIntervalMs
                : DEFAULTS.pollIntervalMs,
          };
        }
      } catch {
        // malformed, use defaults
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
// Tmux Helpers (pane-targeted)
// =============================================================================

function getTmuxSocket(): string | null {
  const tmuxEnv = process.env.TMUX;
  if (!tmuxEnv) return null;
  const [socket] = tmuxEnv.split(",");
  return socket || null;
}

async function execTmux(args: string[]): Promise<string | null> {
  const socket = getTmuxSocket();
  if (!socket) return null;
  try {
    const result = await execFileAsync("tmux", ["-S", socket, ...args], {
      encoding: "utf-8",
      timeout: 2000,
    });
    return result.stdout.trim();
  } catch {
    return null;
  }
}

function getTmuxPaneTarget(): string | null {
  return process.env.TMUX_PANE || null;
}

function hasTmux(): boolean {
  return getTmuxSocket() !== null;
}

async function getCurrentTmuxWindowName(): Promise<string | null> {
  const target = getTmuxPaneTarget();
  const args = target
    ? ["display-message", "-p", "-t", target, "#W"]
    : ["display-message", "-p", "#W"];
  return execTmux(args);
}

async function renameCurrentTmuxWindow(name: string): Promise<boolean> {
  const target = getTmuxPaneTarget();
  const args = target
    ? ["rename-window", "-t", target, name]
    : ["rename-window", name];
  const result = await execTmux(args);
  return result !== null;
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
// Hook State Keys
// =============================================================================

// We store sync-specific state in state.hookState to persist across hook calls.
interface IdentitySyncState {
  lastObservedTmuxWindowName?: string;
  suppressTmuxRenameUntil: number;
}

function getSyncState(state: MeshState): IdentitySyncState {
  if (!state.hookState) state.hookState = {};
  if (!state.hookState._identitySync) {
    state.hookState._identitySync = {
      suppressTmuxRenameUntil: 0,
    };
  }
  return state.hookState._identitySync as IdentitySyncState;
}

// =============================================================================
// Sync Logic
// =============================================================================

async function syncTmuxWindowToAgentName(
  state: MeshState,
  syncState: IdentitySyncState,
  syncConfig: IdentitySyncConfig,
  name: string,
): Promise<void> {
  if (!syncConfig.meshToTmux || !hasTmux()) return;

  const renamed = await renameCurrentTmuxWindow(name);
  if (!renamed) return;

  const observedWindowName = await getCurrentTmuxWindowName();
  syncState.lastObservedTmuxWindowName = observedWindowName ?? name;
  syncState.suppressTmuxRenameUntil = Date.now() + syncConfig.pollIntervalMs * 2;
}

function notifyIdentitySyncFailure(
  ctx: ExtensionContext,
  windowName: string,
  error: string | undefined,
): void {
  if (!ctx.hasUI) return;
  if (error === "same_name") return;

  const message =
    error === "invalid_name"
      ? `Window name "${windowName}" is not a valid mesh name.`
      : error === "name_taken"
        ? `Window name "${windowName}" is already taken on the mesh.`
        : `Couldn't sync window name "${windowName}" to the mesh.`;

  ctx.ui.notify(message, "warning");
}

// =============================================================================
// Hook Entry Point
// =============================================================================

export function createHooks(_meshConfig: MeshConfig): MeshLifecycleHooks {
  const syncConfig = loadIdentitySyncConfig();

  if (!syncConfig.enabled) {
    // Even when sync is disabled, set the runtime name for UI display.
    return {
      onRegistered(state, ctx) {
        refreshRuntimeIdentity(state, ctx);
      },
    };
  }

  return {
    async onRegistered(state, ctx, actions) {
      refreshRuntimeIdentity(state, ctx);

      if (!hasTmux()) return;

      const syncState = getSyncState(state);
      const currentWindowName = await getCurrentTmuxWindowName();
      syncState.lastObservedTmuxWindowName = currentWindowName ?? state.agentName;

      // Startup alignment: make tmux match the mesh name.
      if (syncConfig.startupAlign && currentWindowName && currentWindowName !== state.agentName) {
        await syncTmuxWindowToAgentName(state, syncState, syncConfig, state.agentName);
      }

      // Set the poll interval for onPollTick.
      if (!state.hookState) state.hookState = {};
      state.hookState.pollIntervalMs = syncConfig.pollIntervalMs;
    },

    async onRenamed(state, ctx, _result, actions) {
      refreshRuntimeIdentity(state, ctx);

      // Notify the LLM of the name change so it updates its self-reference.
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

      if (!hasTmux()) return;

      const syncState = getSyncState(state);
      await syncTmuxWindowToAgentName(state, syncState, syncConfig, state.agentName);
    },

    async onPollTick(state, ctx, actions) {
      if (!syncConfig.tmuxToMesh || !hasTmux() || !state.registered) return;

      const syncState = getSyncState(state);
      if (Date.now() < syncState.suppressTmuxRenameUntil) return;

      const windowName = await getCurrentTmuxWindowName();
      if (!windowName) return;
      if (windowName === syncState.lastObservedTmuxWindowName) return;

      syncState.lastObservedTmuxWindowName = windowName;

      if (windowName === state.agentName) return;

      // tmux window was renamed externally — push into mesh.
      const renameResult = await actions.rename(windowName);

      if (!renameResult.success) {
        notifyIdentitySyncFailure(ctx, windowName, renameResult.error);

        // Revert tmux back to the current valid mesh name.
        if (renameResult.error !== "same_name") {
          await syncTmuxWindowToAgentName(state, syncState, syncConfig, state.agentName);
        }
      }
      // On success, onRenamed fires automatically (actions.rename calls it).
    },

    onShutdown(_state) {
      // No timers to clean up — pi-mesh manages the poll timer lifecycle.
    },
  };
}
