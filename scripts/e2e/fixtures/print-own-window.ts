import { execFileSync } from "node:child_process";

const socket = process.env.TMUX?.split(",")[0];
const pane = process.env.TMUX_PANE;
if (!socket) throw new Error("TMUX not set");

const args = pane
  ? ["-S", socket, "display-message", "-p", "-t", pane, "#W"]
  : ["-S", socket, "display-message", "-p", "#W"];

const name = execFileSync("tmux", args, { encoding: "utf-8", timeout: 2000 }).trim();
if (!name) throw new Error("failed to resolve current tmux window name");

console.log(name);
