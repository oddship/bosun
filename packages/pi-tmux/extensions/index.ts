/**
 * pi-tmux — Terminal power tools for Pi.
 *
 * Provides tools for tmux manipulation: split panes, send keystrokes,
 * capture screen content, list windows, and kill windows.
 *
 * All operations go through pi-tmux/core.ts which auto-detects the tmux
 * socket from $TMUX and targets the correct session via $TMUX_PANE.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  isInTmux,
  getTmuxContext,
  splitPane,
  sendKeys,
  capturePane,
  listWindowsDetailed,
  killWindow,
} from "../core.js";

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
    description: "Open a command in a new tmux split pane. Wraps the command in an interactive bash shell so aliases and .bashrc apply.",
    promptSnippet: "Open a command in a new tmux split pane.",
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to run in the new pane" }),
      vertical: Type.Optional(Type.Boolean({ description: "Split vertically (default: horizontal)", default: false })),
      size: Type.Optional(Type.Number({ description: "Pane size as percentage (e.g., 30 for 30%)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!isInTmux()) return notInTmux();

      const result = await splitPane({
        command: params.command,
        vertical: params.vertical,
        size: params.size,
        cwd: ctx.cwd,
      });

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
    description: "Send literal text or tmux key names (C-c, Escape, Enter, etc.) to a tmux window or pane. Sends Enter after text by default. Key sequences are space-separated tmux key names; everything else is sent as literal text.",
    promptSnippet: "Send text or keystrokes to a tmux window/pane. Use to communicate with other agents or interactive programs.",
    parameters: Type.Object({
      target: Type.String({ description: "Window name or index (e.g., 'lite' or '2')" }),
      text: Type.String({ description: "Text to send (press Enter after by default)" }),
      no_enter: Type.Optional(Type.Boolean({ description: "Don't press Enter after text", default: false })),
    }),
    async execute(_id, params) {
      if (!isInTmux()) return notInTmux();

      const ctx = await getTmuxContext();

      // Detect tmux key names vs literal text.
      // Key names: C-c, M-a, Escape, Enter, Space, Tab, arrow keys, function keys.
      const tmuxKeyPattern = /^(C-[a-z]|M-[a-z]|Escape|Enter|Space|Tab|Up|Down|Left|Right|BSpace|DC|End|Home|IC|NPage|PPage|F[0-9]+)$/i;
      const tokens = params.text.trim().split(/\s+/);
      const isKeySequence = tokens.length > 0 && tokens.every(t => tmuxKeyPattern.test(t));

      if (!isKeySequence) {
        // Literal text mode
        const result = await sendKeys(params.target, params.text, { session: ctx.session, literal: true });
        if (result.code !== 0) {
          return { content: [{ type: "text", text: `Error: ${result.stderr}` }], isError: true };
        }
        if (!params.no_enter) {
          const enterResult = await sendKeys(params.target, "Enter", { session: ctx.session, literal: false });
          if (enterResult.code !== 0) {
            return { content: [{ type: "text", text: `Error sending Enter: ${enterResult.stderr}` }], isError: true };
          }
        }
        return { content: [{ type: "text", text: `Sent to '${params.target}': ${params.text}` }] };
      }

      // Key sequence mode — send all keys as tmux key names
      // tmux send-keys accepts multiple key names as separate arguments
      for (const key of tokens) {
        const result = await sendKeys(params.target, key, { session: ctx.session, literal: false });
        if (result.code !== 0) {
          return { content: [{ type: "text", text: `Error: ${result.stderr}` }], isError: true };
        }
      }
      return { content: [{ type: "text", text: `Sent to '${params.target}': ${params.text}` }] };
    },
  });

  // --- capture_pane ---
  pi.registerTool({
    name: "capture_pane",
    label: "Capture Pane",
    description: "Capture the visible screen content of a tmux window. Returns the last N lines (default 50) of the window's terminal output.",
    promptSnippet: "Capture screen content from a tmux window. ONLY for non-mesh agents (e.g., Q) or debugging stuck agents. If the agent has mesh tools, wait for their mesh_send report instead — NEVER poll with capture_pane.",
    parameters: Type.Object({
      target: Type.String({ description: "Window name or index" }),
      lines: Type.Optional(Type.Number({ description: "Number of lines to capture (default: 50)", default: 50 })),
    }),
    async execute(_id, params) {
      if (!isInTmux()) return notInTmux();

      const ctx = await getTmuxContext();
      const result = await capturePane(params.target, { session: ctx.session, lines: params.lines ?? 50 });

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
    description: "List all tmux windows with their index, name, and active status.",
    promptSnippet: "List all tmux windows in the current session.",
    parameters: Type.Object({}),
    async execute() {
      if (!isInTmux()) return notInTmux();

      const ctx = await getTmuxContext();
      const result = await listWindowsDetailed({ session: ctx.session });

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
    description: "Destroy a tmux window by name or index. The window and all processes in it are terminated immediately.",
    promptSnippet: "Kill a tmux window by name or index. Use to clean up finished agent windows or stuck processes.",
    parameters: Type.Object({
      target: Type.String({ description: "Window name or index to kill" }),
    }),
    async execute(_id, params) {
      if (!isInTmux()) return notInTmux();

      const ctx = await getTmuxContext();
      const result = await killWindow(params.target, { session: ctx.session });

      if (result.code !== 0) {
        return { content: [{ type: "text", text: `Error: ${result.stderr}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Killed window '${params.target}'.` }] };
    },
  });
}
