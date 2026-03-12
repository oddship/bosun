#!/usr/bin/env bun
// tmux-session-sidebar.ts — Interactive vertical session/window picker with mesh integration
// Renders a navigable tree of sessions, windows, and agent activity.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Types ──────────────────────────────────────────────────────────────

interface TmuxSession {
  name: string;
  windows: number;
  attached: boolean;
}

interface TmuxWindow {
  session: string;
  index: number;
  name: string;
  active: boolean;
  panes: number;
}

interface MeshPeer {
  name: string;
  agentType: string;
  pid: number;
  model?: string;
  startedAt?: string;
  status?: string;
  activity?: {
    lastActivityAt?: string;
    currentTool?: string;
    lastTool?: string;
    description?: string;
  };
  reservations?: string[];
  session?: {
    toolCalls?: number;
    tokens?: number;
    filesModified?: string[];
  };
}

interface ListEntry {
  target: string; // "__session__:name" or "session:winIdx"
  display: string; // rendered line
  type: "session" | "window" | "separator";
}

// ── ANSI helpers ───────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  blue: "\x1b[38;5;111m",
  green: "\x1b[38;5;114m",
  purple: "\x1b[38;5;141m",
  gray: "\x1b[38;5;102m",
  darkGray: "\x1b[38;5;59m",
  white: "\x1b[38;5;252m",
  yellow: "\x1b[38;5;222m",
  red: "\x1b[38;5;204m",
  orange: "\x1b[38;5;215m",
  bgHL: "\x1b[48;5;236m",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clearScreen: "\x1b[2J\x1b[H",
};

// Strip ANSI escape codes for measuring visible width
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// Truncate a string with ANSI codes to a visible width
function truncate(str: string, maxWidth: number): string {
  const visible = stripAnsi(str);
  if (visible.length <= maxWidth) return str;

  // Walk the original string tracking visible chars
  let visibleCount = 0;
  let i = 0;
  while (i < str.length && visibleCount < maxWidth - 1) {
    if (str[i] === "\x1b") {
      // Skip ANSI sequence
      const end = str.indexOf("m", i);
      if (end !== -1) {
        i = end + 1;
        continue;
      }
    }
    visibleCount++;
    i++;
  }
  return str.slice(0, i) + "…" + C.reset;
}

// ── tmux queries ───────────────────────────────────────────────────────

function tmux(...args: string[]): string {
  try {
    return execFileSync("tmux", args, { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function getSessions(): TmuxSession[] {
  const raw = tmux("list-sessions", "-F", "#{session_name}|#{session_windows}|#{session_attached}");
  if (!raw) return [];
  return raw.split("\n").map((line) => {
    const [name, windows, attached] = line.split("|");
    return { name, windows: parseInt(windows), attached: attached === "1" };
  });
}

function getWindows(session: string): TmuxWindow[] {
  const raw = tmux(
    "list-windows", "-t", session, "-F",
    "#{window_index}|#{window_name}|#{window_active}|#{window_panes}"
  );
  if (!raw) return [];
  return raw.split("\n").map((line) => {
    const [index, name, active, panes] = line.split("|");
    return {
      session,
      index: parseInt(index),
      name,
      active: active === "1",
      panes: parseInt(panes),
    };
  });
}

// ── Mesh ───────────────────────────────────────────────────────────────

function getMeshPeers(): MeshPeer[] {
  const meshRoot = process.env.BOSUN_ROOT
    ? join(process.env.BOSUN_ROOT, ".pi", "mesh", "registry")
    : join(process.cwd(), ".pi", "mesh", "registry");

  try {
    const files = readdirSync(meshRoot).filter((f) => f.endsWith(".json"));
    const peers: MeshPeer[] = [];

    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(meshRoot, file), "utf-8")) as MeshPeer;
        // Check if process is alive
        try {
          process.kill(data.pid, 0);
          peers.push(data);
        } catch {
          // process dead, skip
        }
      } catch {
        // skip malformed
      }
    }
    return peers;
  } catch {
    return [];
  }
}

function peerStatusLine(peer: MeshPeer): string {
  const tool = peer.activity?.currentTool || peer.activity?.lastTool;
  const status = peer.status;
  const desc = peer.activity?.description;

  if (status) return status;
  if (desc) return desc;
  if (tool) return `using ${tool}`;

  const calls = peer.session?.toolCalls ?? 0;
  if (calls === 0) return "idle";
  return `${calls} tool calls`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

// ── Build display list ─────────────────────────────────────────────────

function buildList(): { entries: ListEntry[]; initialSelected: number } {
  const currentSession = tmux("display-message", "-p", "#S");
  const sessions = getSessions();
  const peers = getMeshPeers();
  const entries: ListEntry[] = [];
  let initialSelected = 0;

  // Popup width minus borders/padding (self-adjusting)
  const maxContentWidth = Math.max(20, (process.stdout.columns || 38) - 4);

  // Map: window name → peers working in it
  // Convention: bosun names windows and agents the same way (e.g., "lite-1")
  const windowPeerMap = new Map<string, MeshPeer[]>();
  for (const peer of peers) {
    const key = peer.name;
    if (!windowPeerMap.has(key)) windowPeerMap.set(key, []);
    windowPeerMap.get(key)!.push(peer);
  }

  // Cache windows per session to avoid double tmux calls
  const windowCache = new Map<string, TmuxWindow[]>();

  for (let si = 0; si < sessions.length; si++) {
    const session = sessions[si];
    const isCurrent = session.name === currentSession;

    // Session header
    let marker: string, style: string;
    if (isCurrent) {
      marker = "●";
      style = `${C.bold}${C.blue}`;
    } else if (session.attached) {
      marker = "◉";
      style = `${C.bold}${C.green}`;
    } else {
      marker = "○";
      style = C.white;
    }

    entries.push({
      target: `__session__:${session.name}`,
      display: truncate(`${style}${marker} ${session.name}${C.dim} (${session.windows})${C.reset}`, maxContentWidth),
      type: "session",
    });

    // Windows
    const windows = getWindows(session.name);
    windowCache.set(session.name, windows);

    for (const win of windows) {
      const isActiveWin = isCurrent && win.active;

      let winLine: string;
      if (isActiveWin) {
        winLine = `  ${C.blue}▸ ${win.index}:${win.name}${C.reset}`;
        initialSelected = entries.length;
      } else if (win.active) {
        winLine = `  ${C.green}▸ ${win.index}:${win.name}${C.reset}`;
      } else {
        winLine = `  ${C.gray}  ${win.index}:${win.name}${C.reset}`;
      }

      entries.push({
        target: `${session.name}:${win.index}`,
        display: truncate(winLine, maxContentWidth),
        type: "window",
      });

      // Check for mesh peer matching this window
      const winPeers = windowPeerMap.get(win.name) || [];
      if (winPeers.length > 0) {
        const peer = winPeers[0];
        const statusText = peerStatusLine(peer);
        const modelShort = peer.model ? peer.model.replace(/^claude-/, "").slice(0, 12) : "";
        const lastActive = peer.activity?.lastActivityAt
          ? timeAgo(peer.activity.lastActivityAt)
          : "";

        // Status sub-line
        const statusColor = statusText === "idle" ? C.darkGray : C.yellow;
        entries.push({
          target: `${session.name}:${win.index}`,
          display: truncate(`    ${statusColor}${C.italic}${statusText}${C.reset} ${C.darkGray}${modelShort} ${lastActive}${C.reset}`, maxContentWidth),
          type: "separator",
        });

        // Show reservations if any
        if (peer.reservations && peer.reservations.length > 0) {
          const files = peer.reservations.slice(0, 2).map(f => f.replace(/\/$/, "").split("/").pop()).join(", ");
          const more = peer.reservations.length > 2 ? ` +${peer.reservations.length - 2}` : "";
          entries.push({
            target: `${session.name}:${win.index}`,
            display: truncate(`    ${C.darkGray}🔒 ${files}${more}${C.reset}`, maxContentWidth),
            type: "separator",
          });
        }
      }
    }

    // Spacer between sessions
    if (si < sessions.length - 1) {
      entries.push({
        target: "",
        display: "",
        type: "separator",
      });
    }
  }

  // Mesh agents not matched to any window
  const matchedNames = new Set<string>();
  for (const [, windows] of windowCache) {
    for (const win of windows) {
      matchedNames.add(win.name);
    }
  }
  const unmatchedPeers = peers.filter((p) => !matchedNames.has(p.name));

  if (unmatchedPeers.length > 0) {
    entries.push({ target: "", display: "", type: "separator" });
    entries.push({
      target: "",
      display: `${C.bold}${C.purple}⬡ Mesh Agents${C.reset}`,
      type: "separator",
    });
    entries.push({
      target: "",
      display: `${C.darkGray}${"─".repeat(maxContentWidth - 2)}${C.reset}`,
      type: "separator",
    });

    for (const peer of unmatchedPeers) {
      const statusText = peerStatusLine(peer);
      const statusColor = statusText === "idle" ? C.darkGray : C.yellow;
      const modelShort = peer.model ? peer.model.replace(/^claude-/, "").slice(0, 12) : "";
      entries.push({
        target: "",
        display: truncate(`  ${C.orange}◆ ${peer.name}${C.reset} ${C.darkGray}${modelShort}${C.reset}`, maxContentWidth),
        type: "separator",
      });
      entries.push({
        target: "",
        display: truncate(`    ${statusColor}${C.italic}${statusText}${C.reset}`, maxContentWidth),
        type: "separator",
      });
    }
  }

  return { entries, initialSelected };
}

// ── TUI ────────────────────────────────────────────────────────────────

function draw(entries: ListEntry[], selected: number, termHeight: number) {
  const out: string[] = [];
  out.push(C.clearScreen);

  // Leave room for footer (3 lines)
  const maxVisible = termHeight - 3;

  // Scroll with centering behavior
  let scrollTop = 0;
  if (entries.length > maxVisible) {
    // Keep selection near center, clamped to bounds
    scrollTop = Math.max(0, selected - Math.floor(maxVisible / 2));
    scrollTop = Math.min(scrollTop, entries.length - maxVisible);
  }

  const visible = entries.slice(scrollTop, scrollTop + maxVisible);

  for (let i = 0; i < visible.length; i++) {
    const realIdx = scrollTop + i;
    const entry = visible[i];

    if (entry.type === "separator") {
      out.push(` ${entry.display}\n`);
      continue;
    }

    if (realIdx === selected) {
      out.push(`${C.bgHL}${C.bold}▌${C.reset}${C.bgHL}${entry.display}${C.reset}\n`);
    } else {
      out.push(` ${entry.display}\n`);
    }
  }

  // Footer
  out.push(`\n${C.dim}${C.gray} ↑↓/jk navigate  g/G top/bottom${C.reset}`);
  out.push(`\n${C.dim}${C.gray} ⏎ select  q quit${C.reset}`);

  process.stdout.write(out.join(""));
}

// ── Cleanup ────────────────────────────────────────────────────────────

function cleanup() {
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {}
  process.stdout.write(C.showCursor);
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  let { entries, initialSelected } = buildList();
  if (entries.length === 0) {
    console.log("No sessions found");
    process.exit(1);
  }

  const termHeight = process.stdout.rows || 40;

  // Find selectable indices (skip separators)
  let selectableIndices = entries
    .map((e, i) => (e.type !== "separator" ? i : -1))
    .filter((i) => i >= 0);

  if (selectableIndices.length === 0) {
    process.exit(1);
  }

  // Find closest selectable to initialSelected
  let selectedPos = selectableIndices.indexOf(initialSelected);
  if (selectedPos < 0) selectedPos = 0;
  let selected = selectableIndices[selectedPos];

  // Setup cleanup
  process.on("exit", cleanup);
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  // Hide cursor
  process.stdout.write(C.hideCursor);

  draw(entries, selected, termHeight);

  // Periodic refresh (every 2s)
  const refreshInterval = setInterval(() => {
    const result = buildList();
    entries = result.entries;

    selectableIndices = entries
      .map((e, i) => (e.type !== "separator" ? i : -1))
      .filter((i) => i >= 0);

    // Clamp selection
    if (selectedPos >= selectableIndices.length) {
      selectedPos = Math.max(0, selectableIndices.length - 1);
    }
    if (selectableIndices.length > 0) {
      selected = selectableIndices[selectedPos];
    }

    draw(entries, selected, termHeight);
  }, 2000);

  // Raw mode for keyboard input
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf-8");

  process.stdin.on("data", (data: string) => {
    const key = data;

    if (key === "q" || key === "Q" || key === "\x03") {
      clearInterval(refreshInterval);
      process.exit(0);
    }

    if (key === "\x1b" || key === "\x1b\x1b") {
      clearInterval(refreshInterval);
      process.exit(0);
    }

    if (key === "\r" || key === "\n") {
      clearInterval(refreshInterval);
      const entry = entries[selected];
      if (entry.target) {
        if (entry.target.startsWith("__session__:")) {
          const sess = entry.target.slice("__session__:".length);
          tmux("switch-client", "-t", sess);
        } else {
          tmux("switch-client", "-t", entry.target);
        }
      }
      process.exit(0);
    }

    // Navigation
    let moved = false;
    if (key === "k" || key === "\x1b[A") {
      if (selectedPos > 0) {
        selectedPos--;
        selected = selectableIndices[selectedPos];
        moved = true;
      }
    } else if (key === "j" || key === "\x1b[B") {
      if (selectedPos < selectableIndices.length - 1) {
        selectedPos++;
        selected = selectableIndices[selectedPos];
        moved = true;
      }
    } else if (key === "g") {
      selectedPos = 0;
      selected = selectableIndices[0];
      moved = true;
    } else if (key === "G") {
      selectedPos = selectableIndices.length - 1;
      selected = selectableIndices[selectedPos];
      moved = true;
    }

    if (moved) {
      draw(entries, selected, termHeight);
    }
  });
}

main();
