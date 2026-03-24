/**
 * pi-tmux/core — Shared tmux primitives.
 *
 * Single source of truth for all tmux operations across bosun packages.
 * Auto-detects socket, session, and pane from environment variables.
 * All high-level functions accept optional overrides for socket/session.
 */

import { spawn, execFileSync } from "node:child_process";

// =============================================================================
// Types
// =============================================================================

export interface TmuxResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface TmuxContext {
  socket: string | null;
  session: string | null;
  pane: string | null;
}

export interface TmuxExecOpts {
  socket?: string | null;
  cwd?: string;
  timeout?: number;
}

// =============================================================================
// Environment Detection (no tmux calls)
// =============================================================================

/**
 * Check if the current process is running inside tmux.
 * Uses $TMUX env var which tmux sets automatically.
 */
export function isInTmux(): boolean {
  return !!process.env.TMUX;
}

/**
 * Extract the tmux socket path from $TMUX env var.
 * $TMUX format: "/path/to/socket,pid,index"
 */
export function getTmuxSocket(): string | null {
  const tmuxEnv = process.env.TMUX;
  if (!tmuxEnv) return null;
  const [socket] = tmuxEnv.split(",");
  return socket || null;
}

/**
 * Get the current tmux pane identifier from $TMUX_PANE.
 * Returns e.g. "%0", "%5", etc.
 */
export function getTmuxPane(): string | null {
  return process.env.TMUX_PANE || null;
}

// =============================================================================
// Execution (low-level)
// =============================================================================

/**
 * Execute a tmux command asynchronously.
 * Prepends `-S <socket>` when a socket is provided or auto-detected.
 */
export function tmuxExec(args: string[], opts?: TmuxExecOpts): Promise<TmuxResult> {
  const socket = opts?.socket ?? getTmuxSocket();
  const fullArgs = socket ? ["-S", socket, ...args] : args;

  return new Promise((resolve) => {
    const proc = spawn("tmux", fullArgs, {
      cwd: opts?.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    let settled = false;
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      resolve({ stdout, stderr, code });
    };

    proc.on("close", (code) => settle(code ?? 1));
    proc.on("error", () => settle(1));

    if (opts?.timeout) {
      setTimeout(() => {
        if (!settled) {
          proc.kill();
          settle(1);
        }
      }, opts.timeout);
    }
  });
}

/**
 * Execute a tmux command synchronously.
 * Prepends `-S <socket>` when a socket is provided or auto-detected.
 * Returns stdout on success, null on failure.
 */
export function tmuxExecSync(args: string[], opts?: { socket?: string | null; timeout?: number }): string | null {
  const socket = opts?.socket ?? getTmuxSocket();
  const fullArgs = socket ? ["-S", socket, ...args] : args;

  try {
    return execFileSync("tmux", fullArgs, {
      encoding: "utf-8",
      timeout: opts?.timeout ?? 5000,
    }).trim();
  } catch {
    return null;
  }
}

// =============================================================================
// Session Queries (require tmux calls)
// =============================================================================

/**
 * Get the tmux session name for the current process.
 * Uses $TMUX_PANE to anchor the lookup — critical when multiple sessions
 * share a socket (e.g. "bosun" and "bosun-daemon").
 */
export async function getTmuxSession(opts?: { socket?: string | null; pane?: string | null }): Promise<string | null> {
  const pane = opts?.pane ?? getTmuxPane();
  const args = ["display-message"];
  if (pane) args.push("-t", pane);
  args.push("-p", "#{session_name}");

  const result = await tmuxExec(args, { socket: opts?.socket, timeout: 3000 });
  return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

/**
 * Get the tmux session name synchronously.
 * Needed by spawn.ts which uses sync operations for the duplicate-window check.
 */
export function getTmuxSessionSync(opts?: { socket?: string | null; pane?: string | null }): string | null {
  const pane = opts?.pane ?? getTmuxPane();
  const args = ["display-message"];
  if (pane) args.push("-t", pane);
  args.push("-p", "#{session_name}");

  return tmuxExecSync(args, { socket: opts?.socket });
}

/**
 * Convenience: get the full tmux context for the current process.
 * Returns socket, session, and pane in one call.
 */
export async function getTmuxContext(): Promise<TmuxContext> {
  const socket = getTmuxSocket();
  const pane = getTmuxPane();
  const session = await getTmuxSession({ socket, pane });
  return { socket, session, pane };
}

// =============================================================================
// Window Operations
// =============================================================================

/**
 * List window names in the given session (or current session).
 */
export async function listWindows(opts?: { socket?: string | null; session?: string | null }): Promise<string[]> {
  const args = ["list-windows"];
  if (opts?.session) args.push("-t", opts.session);
  args.push("-F", "#{window_name}");

  const result = await tmuxExec(args, { socket: opts?.socket, timeout: 3000 });
  if (result.code !== 0 || !result.stdout.trim()) return [];
  return result.stdout.trim().split("\n");
}

/**
 * List windows with index and active status (for the list_windows tool).
 */
export async function listWindowsDetailed(opts?: { socket?: string | null; session?: string | null }): Promise<TmuxResult> {
  const args = ["list-windows"];
  if (opts?.session) args.push("-t", opts.session);
  args.push("-F", "#{window_index}: #{window_name} #{window_active}");

  return tmuxExec(args, { socket: opts?.socket, timeout: 3000 });
}

/**
 * Check if a window with the given name exists in the session.
 * Uses sync execution for blocking checks (e.g. before spawning).
 */
export function windowExists(name: string, opts?: { socket?: string | null; session?: string | null }): boolean {
  const args = ["list-windows"];
  if (opts?.session) args.push("-t", opts.session);
  args.push("-F", "#{window_name}");

  const result = tmuxExecSync(args, { socket: opts?.socket });
  if (!result) return false;
  return result.split("\n").includes(name);
}

/**
 * Create a new tmux window.
 */
export async function newWindow(opts: {
  name: string;
  command: string;
  socket?: string | null;
  session?: string | null;
  env?: Record<string, string>;
  background?: boolean;
  cwd?: string;
}): Promise<TmuxResult> {
  const args = ["new-window"];
  if (opts.background) args.push("-d");
  if (opts.session) args.push("-t", `${opts.session}:`);
  args.push("-n", opts.name);
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      args.push("-e", `${k}=${v}`);
    }
  }
  args.push(opts.command);

  return tmuxExec(args, { socket: opts.socket, cwd: opts.cwd });
}

/**
 * Create a new tmux session with an initial window.
 * `tmux new-session` creates a session AND its first window in one call.
 */
export async function newSession(opts: {
  name: string;
  windowName?: string;
  command: string;
  socket?: string | null;
  env?: Record<string, string>;
  cwd?: string;
}): Promise<TmuxResult> {
  const args = ["new-session", "-d", "-s", opts.name];
  if (opts.windowName) args.push("-n", opts.windowName);
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      args.push("-e", `${k}=${v}`);
    }
  }
  args.push(opts.command);

  return tmuxExec(args, { socket: opts.socket, cwd: opts.cwd });
}

/**
 * Check if a tmux session exists.
 */
export function sessionExists(name: string, opts?: { socket?: string | null }): boolean {
  const result = tmuxExecSync(["has-session", "-t", name], { socket: opts?.socket });
  return result !== null;
}

/**
 * Kill a tmux window by name or index.
 * Session-aware: targets `session:target` when session is provided.
 */
export async function killWindow(target: string, opts?: { socket?: string | null; session?: string | null }): Promise<TmuxResult> {
  const fullTarget = opts?.session ? `${opts.session}:${target}` : target;
  return tmuxExec(["kill-window", "-t", fullTarget], { socket: opts?.socket });
}

// =============================================================================
// Pane Operations
// =============================================================================

/**
 * Split the current (or target) pane.
 */
export async function splitPane(opts: {
  command: string;
  socket?: string | null;
  pane?: string | null;
  vertical?: boolean;
  size?: number;
  cwd?: string;
}): Promise<TmuxResult> {
  const args = ["split-window"];
  const targetPane = opts.pane ?? getTmuxPane();
  if (targetPane) args.push("-t", targetPane);
  if (opts.vertical) args.push("-h");
  if (opts.size) args.push("-p", String(opts.size));
  // Wrap in interactive bash so aliases and .bashrc apply
  args.push("bash", "-ic", opts.command);

  return tmuxExec(args, { socket: opts.socket, cwd: opts.cwd });
}

/**
 * Send text or keys to a tmux target.
 *
 * When `literal` is true, sends with `-l` flag (exact text).
 * When `literal` is false, sends as tmux key names (C-c, Escape, etc.).
 *
 * Key-detection logic (deciding literal vs key-sequence) belongs in the
 * tool wrapper, not here.
 */
export async function sendKeys(
  target: string,
  text: string,
  opts?: { socket?: string | null; session?: string | null; literal?: boolean },
): Promise<TmuxResult> {
  const fullTarget = opts?.session ? `${opts.session}:${target}` : target;
  const args = ["send-keys", "-t", fullTarget];
  if (opts?.literal) {
    args.push("-l");
  }
  args.push(text);
  return tmuxExec(args, { socket: opts?.socket });
}

/**
 * Capture the visible content of a tmux pane/window.
 */
export async function capturePane(
  target: string,
  opts?: { socket?: string | null; session?: string | null; lines?: number },
): Promise<TmuxResult> {
  const fullTarget = opts?.session ? `${opts.session}:${target}` : target;
  const args = ["capture-pane", "-t", fullTarget, "-p"];
  const lines = opts?.lines ?? 50;
  if (lines > 0) args.push("-S", `-${lines}`);
  return tmuxExec(args, { socket: opts?.socket });
}

// =============================================================================
// Window Identity (for mesh-identity-sync)
// =============================================================================

/**
 * Get the name of the current window (pane-targeted).
 */
export async function getWindowName(opts?: { socket?: string | null; pane?: string | null }): Promise<string | null> {
  const pane = opts?.pane ?? getTmuxPane();
  const args = ["display-message", "-p"];
  if (pane) args.push("-t", pane);
  args.push("#W");

  const result = await tmuxExec(args, { socket: opts?.socket, timeout: 2000 });
  return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

/**
 * Rename the current window (pane-targeted).
 */
export async function renameWindow(
  name: string,
  opts?: { socket?: string | null; pane?: string | null },
): Promise<boolean> {
  const pane = opts?.pane ?? getTmuxPane();
  const args = ["rename-window"];
  if (pane) args.push("-t", pane);
  args.push(name);

  const result = await tmuxExec(args, { socket: opts?.socket, timeout: 2000 });
  return result.code === 0;
}
