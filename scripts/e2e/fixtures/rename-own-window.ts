import { execFileSync } from "node:child_process";

const name = process.argv[2];
if (!name) {
  throw new Error("usage: bun rename-own-window.ts <name>");
}

const socket = process.env.TMUX?.split(",")[0];
const pane = process.env.TMUX_PANE;
if (!socket) throw new Error("TMUX not set");

const args = pane
  ? ["-S", socket, "rename-window", "-t", pane, name]
  : ["-S", socket, "rename-window", name];

execFileSync("tmux", args, { encoding: "utf-8", timeout: 2000 });
