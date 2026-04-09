#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { stdin, stdout, stderr, argv, exit } from "node:process";
import { buildLaunchSpec, loadConfig } from "../../pi-agents/src/index.ts";

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getBosunPackageRoot(): string {
  if (process.env.BOSUN_PKG) return path.resolve(process.env.BOSUN_PKG);
  return path.resolve(import.meta.dirname, "../../..");
}

function findProjectRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  while (true) {
    if (
      fs.existsSync(path.join(dir, ".bosun-root")) ||
      fs.existsSync(path.join(dir, "config.toml")) ||
      fs.existsSync(path.join(dir, ".pi", "agents.json"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.resolve(startDir);
    }
    dir = parent;
  }
}

function getTmuxSocket(projectRoot: string, bosunPkg: string): string {
  return execFileSync("bash", [path.join(bosunPkg, "scripts", "tmux-socket.sh"), projectRoot], { encoding: "utf-8" }).trim();
}

function tmux(projectRoot: string, bosunPkg: string, args: string[], opts: { stdio?: "inherit" | "pipe" } = {}): string {
  const socket = getTmuxSocket(projectRoot, bosunPkg);
  const output = execFileSync("tmux", ["-S", socket, ...args], {
    encoding: "utf-8",
    stdio: opts.stdio ?? "pipe",
  });
  return typeof output === "string" ? output.trim() : "";
}

function tmuxOk(projectRoot: string, bosunPkg: string, args: string[]): boolean {
  try {
    tmux(projectRoot, bosunPkg, args);
    return true;
  } catch {
    return false;
  }
}

function getGlobalEnv(projectRoot: string, bosunPkg: string, key: string): string {
  try {
    const raw = tmux(projectRoot, bosunPkg, ["show-environment", "-g", key]);
    return raw.includes("=") ? raw.split("=").slice(1).join("=") : "";
  } catch {
    return "";
  }
}

function checkSandboxVersion(projectRoot: string, bosunPkg: string, expected: "1" | "2"): void {
  const version = getGlobalEnv(projectRoot, bosunPkg, "BOSUN_SANDBOX_VERSION") || "1";
  if (version !== expected) {
    throw new Error("Security update: tmux server must run inside sandbox. Please restart: bosun stop && bosun start");
  }
}

function resolveBundledBinary(bosunPkg: string, name: string): string | undefined {
  const localBin = path.join(bosunPkg, "node_modules", ".bin", name);
  if (fs.existsSync(localBin)) return localBin;
  return undefined;
}

function setTmuxEnv(projectRoot: string, bosunPkg: string, defaultAgent: string): void {
  const socket = getTmuxSocket(projectRoot, bosunPkg);
  const entries: Array<[string, string | undefined]> = [
    ["BOSUN_ROOT", projectRoot],
    ["BOSUN_PKG", bosunPkg],
    ["BOSUN_PI_PATH", process.env.BOSUN_PI_PATH || resolveBundledBinary(bosunPkg, "pi") || execFileSync("bash", ["-lc", "command -v pi"], { encoding: "utf-8" }).trim()],
    ["BOSUN_BUN_PATH", process.env.BOSUN_BUN_PATH || execFileSync("bash", ["-lc", "command -v bun"], { encoding: "utf-8" }).trim()],
    ["BOSUN_BWRAP_PATH", process.env.BOSUN_BWRAP_PATH || execFileSync("bash", ["-lc", "command -v bwrap || true"], { encoding: "utf-8" }).trim() || undefined],
    ["BOSUN_DEFAULT_AGENT", defaultAgent],
  ];

  for (const [key, value] of entries) {
    if (!value) continue;
    execFileSync("tmux", ["-S", socket, "set-environment", "-g", key, value], { stdio: "inherit" });
  }
}

function ensureDirs(projectRoot: string): void {
  fs.mkdirSync(path.join(projectRoot, ".bosun-home", ".pi", "agent"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "workspace"), { recursive: true });
}

function checkInsideTmux(projectRoot: string, bosunPkg: string): void {
  if (!process.env.TMUX) return;
  const currentSocket = process.env.TMUX.split(",")[0];
  const bosunSocket = getTmuxSocket(projectRoot, bosunPkg);
  if (currentSocket === bosunSocket) {
    console.log("Already inside Bosun's tmux.");
    console.log("  Ctrl+A s      - Switch session");
    console.log("  Ctrl+A w      - List windows");
    exit(0);
  }
}

function keepAliveCommand(command: string): string {
  return `${command}; EXIT=$?; if [ $EXIT -ne 0 ]; then echo \"=== PI EXITED ($EXIT) ===\"; sleep 300; fi`;
}

export function getStartSessionName(projectRoot: string): string {
  const config = loadConfig(projectRoot);
  const spec = buildLaunchSpec(projectRoot, { config });
  return spec.agentName;
}

function attachOrReport(projectRoot: string, bosunPkg: string, targetSession: string): void {
  if (!stdin.isTTY || !stdout.isTTY) {
    console.log(`Session ready: ${targetSession}`);
    console.log(`Attach interactively with: bosun attach ${targetSession}`);
    return;
  }
  tmux(projectRoot, bosunPkg, ["attach", "-t", targetSession], { stdio: "inherit" });
}

function sessionExists(projectRoot: string, bosunPkg: string, sessionName: string): boolean {
  return tmuxOk(projectRoot, bosunPkg, ["has-session", "-t", sessionName]);
}

function printUsage(): void {
  console.log("Usage: bosun <start|start-unsandboxed|run|attach|stop|init|doctor|onboard>");
}

function splitModelReference(model: string): { provider?: string; modelId: string } {
  const slash = model.indexOf("/");
  if (slash === -1) return { modelId: model };
  return {
    provider: model.slice(0, slash),
    modelId: model.slice(slash + 1),
  };
}

function buildPiCommand(projectRoot: string, bosunPkg: string, sessionName: string, promptArgs: string[], spec: ReturnType<typeof buildLaunchSpec>): string {
  const piBinary = process.env.BOSUN_PI_PATH || resolveBundledBinary(bosunPkg, "pi") || "pi";
  const args: string[] = [piBinary];
  if (spec.model) {
    const resolvedModel = splitModelReference(spec.model);
    if (resolvedModel.provider) args.push("--provider", resolvedModel.provider);
    args.push("--model", resolvedModel.modelId);
  }
  if (spec.thinking) args.push("--thinking", spec.thinking);
  args.push(...promptArgs);

  const env = [
    `BOSUN_ROOT=${shellEscape(projectRoot)}`,
    `BOSUN_WORKSPACE=${shellEscape(path.join(projectRoot, "workspace"))}`,
    `PI_CODING_AGENT_DIR=${shellEscape(path.join(projectRoot, ".bosun-home", ".pi", "agent"))}`,
    `PI_AGENT=${shellEscape(spec.agentName)}`,
    `PI_AGENT_NAME=${shellEscape(sessionName)}`,
  ];

  return keepAliveCommand(`cd ${shellEscape(projectRoot)} && ${env.join(" ")} ${args.map(shellEscape).join(" ")}`);
}

function listBosunSessions(projectRoot: string, bosunPkg: string): string[] {
  try {
    return tmux(projectRoot, bosunPkg, ["list-sessions", "-F", "#{session_name}"])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((name) => name !== "bosun-daemon");
  } catch {
    return [];
  }
}

function nextSessionName(projectRoot: string, bosunPkg: string, prefix: string): string {
  const existing = new Set<string>();
  try {
    for (const name of tmux(projectRoot, bosunPkg, ["list-sessions", "-F", "#{session_name}"]).split("\n")) {
      if (name.trim()) existing.add(name.trim());
    }
  } catch {}
  try {
    for (const name of tmux(projectRoot, bosunPkg, ["list-windows", "-a", "-F", "#{window_name}"]).split("\n")) {
      if (name.trim()) existing.add(name.trim());
    }
  } catch {}

  if (!existing.has(prefix)) return prefix;
  let n = 2;
  while (existing.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

function nextWindowName(projectRoot: string, bosunPkg: string, prefix: string): string {
  const existing = new Set<string>();
  try {
    for (const name of tmux(projectRoot, bosunPkg, ["list-windows", "-a", "-F", "#{window_name}"]).split("\n")) {
      if (name.trim()) existing.add(name.trim());
    }
  } catch {}
  let n = 2;
  while (existing.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

function ensureConfig(projectRoot: string, bosunPkg: string): void {
  const configToml = path.join(projectRoot, "config.toml");
  const settingsJson = path.join(projectRoot, ".pi", "settings.json");
  if (!fs.existsSync(configToml)) return;
  if (!fs.existsSync(settingsJson)) {
    console.log("No generated config found. Running init...");
    runBosunScript(projectRoot, bosunPkg, path.join(bosunPkg, "scripts", "init.ts"));
  }
}

function ensureDaemon(projectRoot: string, bosunPkg: string): void {
  const daemonConfig = path.join(projectRoot, ".pi", "daemon.json");
  if (!fs.existsSync(daemonConfig)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(daemonConfig, "utf-8")) as { enabled?: boolean };
    if (!parsed.enabled) return;
  } catch {
    return;
  }

  if (tmuxOk(projectRoot, bosunPkg, ["has-session", "-t", "bosun-daemon"])) return;

  if (tmuxOk(projectRoot, bosunPkg, ["has-session"])) {
    checkSandboxVersion(projectRoot, bosunPkg, "2");
    tmux(projectRoot, bosunPkg, [
      "new-session", "-d", "-s", "bosun-daemon", "-n", "daemon",
      `/bin/sh -c ${shellEscape(`cd ${shellEscape(projectRoot)} && bun ${shellEscape(path.join(bosunPkg, "packages", "pi-daemon", "src", "index.ts"))}; sleep 300`)}`,
    ], { stdio: "inherit" });
  } else {
    execFileSync(path.join(bosunPkg, "scripts", "sandbox.sh"), [
      "tmux", "-S", getTmuxSocket(projectRoot, bosunPkg), "-f", path.join(bosunPkg, "config", "tmux.conf"),
      "new-session", "-d", "-s", "bosun-daemon", "-n", "daemon",
      `/bin/sh -c ${shellEscape(`cd ${shellEscape(projectRoot)} && bun ${shellEscape(path.join(bosunPkg, "packages", "pi-daemon", "src", "index.ts"))}; sleep 300`)}`,
    ], { stdio: "inherit" });
    tmux(projectRoot, bosunPkg, ["set-environment", "-g", "BOSUN_SANDBOX_VERSION", "2"], { stdio: "inherit" });
  }

  tmux(projectRoot, bosunPkg, ["set-environment", "-g", "BOSUN_ROOT", projectRoot], { stdio: "inherit" });
}

function runBosunScript(projectRoot: string, bosunPkg: string, scriptPath: string, extraArgs: string[] = []): void {
  execFileSync("bun", [scriptPath, ...extraArgs], {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, BOSUN_PKG: bosunPkg, BOSUN_ROOT: projectRoot },
  });
}

async function cmdStart(projectRoot: string, bosunPkg: string, opts: { sandboxed: boolean; promptArgs: string[] }): Promise<void> {
  ensureConfig(projectRoot, bosunPkg);
  ensureDirs(projectRoot);
  checkInsideTmux(projectRoot, bosunPkg);

  const targetSession = getStartSessionName(projectRoot);
  const config = loadConfig(projectRoot);
  const spec = buildLaunchSpec(projectRoot, { config });

  if (tmuxOk(projectRoot, bosunPkg, ["has-session", "-t", targetSession])) {
    if (opts.sandboxed) checkSandboxVersion(projectRoot, bosunPkg, "2");
    console.log(`Attaching to existing session '${targetSession}'...`);
    attachOrReport(projectRoot, bosunPkg, targetSession);
    return;
  }

  const command = buildPiCommand(projectRoot, bosunPkg, targetSession, opts.promptArgs, spec);
  if (tmuxOk(projectRoot, bosunPkg, ["has-session"])) {
    if (opts.sandboxed) checkSandboxVersion(projectRoot, bosunPkg, "2");
    tmux(projectRoot, bosunPkg, ["new-session", "-d", "-s", targetSession, "-n", targetSession, `/bin/sh -c ${shellEscape(command)}`], { stdio: "inherit" });
  } else if (opts.sandboxed) {
    execFileSync(path.join(bosunPkg, "scripts", "sandbox.sh"), [
      "tmux", "-S", getTmuxSocket(projectRoot, bosunPkg), "-f", path.join(bosunPkg, "config", "tmux.conf"),
      "new-session", "-d", "-s", targetSession, "-n", targetSession, `/bin/sh -c ${shellEscape(command)}`,
    ], { stdio: "inherit" });
    tmux(projectRoot, bosunPkg, ["set-environment", "-g", "BOSUN_SANDBOX_VERSION", "2"], { stdio: "inherit" });
  } else {
    tmux(projectRoot, bosunPkg, ["-f", path.join(bosunPkg, "config", "tmux.conf"), "new-session", "-d", "-s", targetSession, "-n", targetSession, `/bin/sh -c ${shellEscape(command)}`], { stdio: "inherit" });
    tmux(projectRoot, bosunPkg, ["set-environment", "-g", "BOSUN_SANDBOX_VERSION", "1"], { stdio: "inherit" });
  }

  setTmuxEnv(projectRoot, bosunPkg, spec.agentName);
  if (opts.sandboxed) ensureDaemon(projectRoot, bosunPkg);
  attachOrReport(projectRoot, bosunPkg, targetSession);
}

function cmdRun(projectRoot: string, bosunPkg: string, args: string[], flags: { window: boolean }): void {
  ensureConfig(projectRoot, bosunPkg);
  ensureDirs(projectRoot);
  const config = loadConfig(projectRoot);
  const spec = buildLaunchSpec(projectRoot, { config });

  if (flags.window) {
    const sessionName = getGlobalEnv(projectRoot, bosunPkg, "BOSUN_DEFAULT_AGENT") || spec.agentName;
    const windowName = nextWindowName(projectRoot, bosunPkg, sessionName);
    const command = buildPiCommand(projectRoot, bosunPkg, windowName, args, spec);
    tmux(projectRoot, bosunPkg, ["new-window", "-n", windowName, "-c", projectRoot, `/bin/sh -c ${shellEscape(command)}`], { stdio: "inherit" });
    return;
  }

  const sessionName = nextSessionName(projectRoot, bosunPkg, spec.agentName);
  const command = buildPiCommand(projectRoot, bosunPkg, sessionName, args, spec);
  if (tmuxOk(projectRoot, bosunPkg, ["has-session"])) {
    checkSandboxVersion(projectRoot, bosunPkg, "2");
    tmux(projectRoot, bosunPkg, ["new-session", "-d", "-s", sessionName, "-n", sessionName, `/bin/sh -c ${shellEscape(command)}`], { stdio: "inherit" });
  } else {
    execFileSync(path.join(bosunPkg, "scripts", "sandbox.sh"), [
      "tmux", "-S", getTmuxSocket(projectRoot, bosunPkg), "-f", path.join(bosunPkg, "config", "tmux.conf"),
      "new-session", "-d", "-s", sessionName, "-n", sessionName, `/bin/sh -c ${shellEscape(command)}`,
    ], { stdio: "inherit" });
    tmux(projectRoot, bosunPkg, ["set-environment", "-g", "BOSUN_SANDBOX_VERSION", "2"], { stdio: "inherit" });
  }
  setTmuxEnv(projectRoot, bosunPkg, spec.agentName);
  attachOrReport(projectRoot, bosunPkg, sessionName);
}

async function cmdAttach(projectRoot: string, bosunPkg: string, session?: string): Promise<void> {
  if (session) {
    if (!sessionExists(projectRoot, bosunPkg, session)) {
      throw new Error(`Session '${session}' not found`);
    }
    attachOrReport(projectRoot, bosunPkg, session);
    return;
  }

  const sessions = listBosunSessions(projectRoot, bosunPkg);
  if (sessions.length === 0) {
    if (tmuxOk(projectRoot, bosunPkg, ["has-session", "-t", "bosun-daemon"])) {
      console.log("No agent sessions running (daemon is active). Starting one...");
      await cmdStart(projectRoot, bosunPkg, { sandboxed: true, promptArgs: [] });
      return;
    }
    throw new Error("No agent sessions running. Start one with: bosun start");
  }

  if (sessions.length === 1) {
    attachOrReport(projectRoot, bosunPkg, sessions[0]);
    return;
  }

  console.log("Multiple sessions available:");
  sessions.forEach((name, index) => console.log(`${index + 1}. ${name}`));

  if (!stdin.isTTY || !stdout.isTTY) {
    console.log("Run an explicit attach command, for example:");
    console.log(`  bosun attach ${sessions[0]}`);
    return;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question("Pick session number [1]: ");
  rl.close();
  const pick = Number(answer || "1");
  const target = sessions[pick - 1];
  if (!target) throw new Error("Invalid selection");
  attachOrReport(projectRoot, bosunPkg, target);
}

function cmdStop(projectRoot: string, bosunPkg: string): void {
  const sessions = listBosunSessions(projectRoot, bosunPkg);
  if (sessions.length === 0 && !tmuxOk(projectRoot, bosunPkg, ["has-session", "-t", "bosun-daemon"])) {
    console.log("No agent sessions running");
    return;
  }

  const pids = tmux(projectRoot, bosunPkg, ["list-panes", "-a", "-F", "#{pane_pid}"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  try {
    tmux(projectRoot, bosunPkg, ["kill-server"], { stdio: "inherit" });
  } catch {}

  execFileSync("bash", ["-lc", "sleep 1"], { stdio: "inherit" });
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 0);
      console.log(`Cleaning up orphan process ${pid}`);
      process.kill(Number(pid), "SIGTERM");
    } catch {}
  }
  console.log("Stopped.");
}

async function main(): Promise<void> {
  const bosunPkg = getBosunPackageRoot();
  const projectRoot = findProjectRoot(process.cwd());
  const [command = "onboard", ...rest] = argv.slice(2);

  try {
    switch (command) {
      case "start":
        await cmdStart(projectRoot, bosunPkg, { sandboxed: true, promptArgs: rest });
        return;
      case "start-unsandboxed":
        await cmdStart(projectRoot, bosunPkg, { sandboxed: false, promptArgs: rest });
        return;
      case "run": {
        const window = rest.includes("--window");
        cmdRun(projectRoot, bosunPkg, rest.filter((arg) => arg !== "--window"), { window });
        return;
      }
      case "attach":
        await cmdAttach(projectRoot, bosunPkg, rest[0]);
        return;
      case "stop":
        cmdStop(projectRoot, bosunPkg);
        return;
      case "init":
        runBosunScript(projectRoot, bosunPkg, path.join(bosunPkg, "scripts", "init.ts"), rest);
        return;
      case "doctor":
      case "onboard":
        execFileSync(path.join(bosunPkg, "scripts", "onboard.sh"), [command], { cwd: projectRoot, stdio: "inherit" });
        return;
      case "help":
      case "--help":
      case "-h":
        printUsage();
        return;
      default:
        printUsage();
        exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    exit(1);
  }
}

if (import.meta.main) {
  await main();
}
