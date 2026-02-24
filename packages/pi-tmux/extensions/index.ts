/**
 * pi-tmux — Terminal power tools for Pi.
 *
 * Provides tools for tmux manipulation: split panes, send keystrokes,
 * capture screen content, and list windows. Auto-detects tmux socket
 * from the $TMUX environment variable.
 */

import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

function isInTmux(): boolean {
  return !!process.env.TMUX;
}

function tmuxExec(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn("tmux", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

function notInTmux() {
  return {
    content: [{ type: "text" as const, text: "Error: Not running inside tmux. Start with `just start` to use tmux tools." }],
    isError: true,
  };
}

export default function (pi: ExtensionAPI) {
  // --- split_pane ---
  pi.registerTool({
    name: "split_pane",
    label: "Split Pane",
    description: "Open a command in a new tmux split pane.",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to run in the new pane" }),
      vertical: Type.Optional(Type.Boolean({ description: "Split vertically (default: horizontal)", default: false })),
      size: Type.Optional(Type.Number({ description: "Pane size as percentage (e.g., 30 for 30%)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!isInTmux()) return notInTmux();

      const args = ["split-window"];
      if (params.vertical) args.push("-h");
      if (params.size) args.push("-p", String(params.size));
      args.push(params.command);

      const result = await tmuxExec(args, ctx.cwd);
      if (result.code !== 0) {
        return { content: [{ type: "text", text: `Error: ${result.stderr || result.stdout}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Split pane opened: ${params.command}` }] };
    },
  });

  // --- send_keys ---
  pi.registerTool({
    name: "send_keys",
    label: "Send Keys",
    description: "Send text or keystrokes to a tmux window/pane. Use to communicate with other agents or interactive programs.",
    parameters: Type.Object({
      target: Type.String({ description: "Window name or index (e.g., 'lite' or '2')" }),
      text: Type.String({ description: "Text to send (press Enter after by default)" }),
      no_enter: Type.Optional(Type.Boolean({ description: "Don't press Enter after text", default: false })),
    }),
    async execute(_id, params) {
      if (!isInTmux()) return notInTmux();

      // Detect tmux key names (C-c, C-d, C-z, Escape, etc.) vs literal text.
      // Tmux send-keys without -l interprets key names; with -l sends literal text.
      // Supports space-separated key sequences like "C-c C-c" or "Escape :q!"
      const tmuxKeyPattern = /^(C-[a-z]|M-[a-z]|Escape|Enter|Space|Tab|Up|Down|Left|Right|BSpace|DC|End|Home|IC|NPage|PPage|F[0-9]+)$/i;
      const tokens = params.text.trim().split(/\s+/);
      const isKeySequence = tokens.length > 0 && tokens.every(t => tmuxKeyPattern.test(t));

      const args = ["send-keys", "-t", params.target];
      if (!isKeySequence) {
        // Literal text mode — send exact text
        args.push("-l", params.text);
        if (!params.no_enter) {
          // Send Enter as a separate key after the literal text
          const result1 = await tmuxExec(args);
          if (result1.code !== 0) {
            return { content: [{ type: "text", text: `Error: ${result1.stderr}` }], isError: true };
          }
          const result2 = await tmuxExec(["send-keys", "-t", params.target, "Enter"]);
          if (result2.code !== 0) {
            return { content: [{ type: "text", text: `Error sending Enter: ${result2.stderr}` }], isError: true };
          }
          return { content: [{ type: "text", text: `Sent to '${params.target}': ${params.text}` }] };
        }
      } else {
        // Key sequence mode — send all keys as tmux key names (no -l)
        args.push(...tokens);
      }

      const result = await tmuxExec(args);
      if (result.code !== 0) {
        return { content: [{ type: "text", text: `Error: ${result.stderr}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Sent to '${params.target}': ${params.text}` }] };
    },
  });

  // --- capture_pane ---
  pi.registerTool({
    name: "capture_pane",
    label: "Capture Pane",
    description: "Capture the current screen content from a tmux window/pane. Use to see what another agent or program is doing.",
    parameters: Type.Object({
      target: Type.String({ description: "Window name or index" }),
      lines: Type.Optional(Type.Number({ description: "Number of lines to capture (default: 50)", default: 50 })),
    }),
    async execute(_id, params) {
      if (!isInTmux()) return notInTmux();

      const lines = params.lines ?? 50;
      const args = ["capture-pane", "-t", params.target, "-p"];
      if (lines > 0) args.push("-S", `-${lines}`);

      const result = await tmuxExec(args);
      if (result.code !== 0) {
        return { content: [{ type: "text", text: `Error capturing '${params.target}': ${result.stderr}` }], isError: true };
      }

      const output = result.stdout.trimEnd();
      return { content: [{ type: "text", text: `Window '${params.target}':\n\n${output}` }] };
    },
  });

  // --- list_windows ---
  pi.registerTool({
    name: "list_windows",
    label: "List Windows",
    description: "List all tmux windows in the current session.",
    parameters: Type.Object({}),
    async execute() {
      if (!isInTmux()) return notInTmux();

      const result = await tmuxExec(["list-windows", "-F", "#{window_index}: #{window_name} #{window_active}"]);
      if (result.code !== 0) {
        return { content: [{ type: "text", text: `Error: ${result.stderr}` }], isError: true };
      }

      const windows = result.stdout
        .trim()
        .split("\n")
        .map((line) => {
          const active = line.endsWith(" 1");
          return active ? `${line.slice(0, -2)} (active)` : line.slice(0, -2);
        })
        .join("\n");

      return { content: [{ type: "text", text: `Tmux windows:\n${windows}` }] };
    },
  });

  // --- kill_window ---
  pi.registerTool({
    name: "kill_window",
    label: "Kill Window",
    description: "Kill a tmux window by name or index. Use to clean up finished agent windows or stuck processes.",
    parameters: Type.Object({
      target: Type.String({ description: "Window name or index to kill" }),
    }),
    async execute(_id, params) {
      if (!isInTmux()) return notInTmux();

      const result = await tmuxExec(["kill-window", "-t", params.target]);
      if (result.code !== 0) {
        return { content: [{ type: "text", text: `Error: ${result.stderr}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Killed window '${params.target}'.` }] };
    },
  });
}
