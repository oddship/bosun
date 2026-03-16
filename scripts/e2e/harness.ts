import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

export interface TmuxHarnessOptions {
  root: string;
  name?: string;
}

export class TmuxHarness {
  readonly root: string;
  readonly socket: string;
  readonly name: string;
  readonly runtimeDir: string;

  constructor(options: TmuxHarnessOptions) {
    this.root = options.root;
    this.name = options.name ?? `e2e-${randomUUID().slice(0, 8)}`;
    this.runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 0}`;
    this.socket = join(this.runtimeDir, "bosun-tmux", `${this.name}.sock`);
    mkdirSync(join(this.runtimeDir, "bosun-tmux"), { recursive: true });
  }

  async tmux(args: string[]): Promise<string> {
    const result = await $`tmux -S ${this.socket} ${args}`.quiet();
    return result.text().trim();
  }

  async startSession(session: string, window: string, command: string): Promise<void> {
    await this.tmux(["-f", join(this.root, "config", "tmux.conf"), "new-session", "-d", "-s", session, "-n", window, command]);
  }

  async newWindow(session: string, window: string, command: string): Promise<void> {
    await this.tmux(["new-window", "-t", session, "-n", window, command]);
  }

  async paneId(target: string): Promise<string> {
    return this.tmux(["display-message", "-p", "-t", target, "#{pane_id}"]);
  }

  async selectWindow(target: string): Promise<void> {
    await this.tmux(["select-window", "-t", target]);
  }

  async sendKeys(target: string, text: string, enter: boolean = true): Promise<void> {
    await this.tmux(["send-keys", "-t", target, "-l", text]);
    if (enter) {
      await this.tmux(["send-keys", "-t", target, "Enter"]);
    }
  }

  async listWindows(session: string): Promise<string[]> {
    const output = await this.tmux(["list-windows", "-t", session, "-F", "#{window_index}:#{window_name}:#{window_active}"]);
    return output.split("\n").filter(Boolean);
  }

  async capturePane(target: string, lines: number = 80): Promise<string> {
    return this.tmux(["capture-pane", "-t", target, "-p", "-S", `-${lines}`]);
  }

  async waitFor(predicate: () => Promise<boolean>, timeoutMs: number = 5000, intervalMs: number = 100): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await Bun.sleep(intervalMs);
    }
    throw new Error(`Timed out after ${timeoutMs}ms`);
  }

  async cleanup(): Promise<void> {
    try {
      await this.tmux(["kill-server"]);
    } catch {
      // ignore
    }
    rmSync(this.socket, { force: true });
  }
}

export function worktreeRoot(): string {
  return join(import.meta.dir, "..", "..");
}

export function fixturePath(name: string): string {
  return join(import.meta.dir, "fixtures", name);
}

export function ensureExists(path: string, message: string): void {
  if (!existsSync(path)) {
    throw new Error(message);
  }
}
