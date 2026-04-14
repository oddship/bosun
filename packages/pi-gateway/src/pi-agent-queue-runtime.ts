#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createBackendContract, type ProcessBackend } from "../../pi-agents/src/backend";
import { loadConfig as loadAgentsConfig } from "../../pi-agents/src/config";
import { buildLaunchSpec } from "../../pi-agents/src/launch";

export type SiteMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  ts: string;
  source: "browser" | "gateway" | "runtime";
  actorId?: string;
  actorLogin?: string;
  visibility?: string;
};

type StructuredSiteAction = {
  type?: string;
  action?: string;
};

export type QueueRoutingDecision = {
  agentName: string;
  sessionPath: string;
  tmuxSessionName: string;
  mode: "default" | "automation";
  actionName?: string;
  backendTarget?: string;
};

type AgentRuntimeOptions = {
  model?: string;
  thinking?: string;
};

interface BrowserMessageHandlerResult {
  handled?: boolean;
  reply?: string;
}

class BrowserMessageHandlerError extends Error {
  readonly publicMessage: string;

  constructor(message: string, publicMessage = "I couldn't process that request right now. Please try again.") {
    super(message);
    this.name = "BrowserMessageHandlerError";
    this.publicMessage = publicMessage;
  }
}

type SessionTextPart = {
  type?: string;
  text?: string;
  textSignature?: string;
};

type RuntimeStateRecord = {
  version: 1;
  updatedAt: string;
  hostSessionName: string | null;
  backendType: string;
  routes: Array<{
    agentName: string;
    tmuxSessionName: string;
    sessionPath: string;
    mode: "default" | "automation";
    backendTarget?: string;
  }>;
};

type SessionReplySnapshot = {
  replyCount: number;
  latestReply: string | null;
};

const ROOT = process.env.BOSUN_ROOT || process.cwd();
const BOSUN_PKG = process.env.BOSUN_PKG ? resolve(process.env.BOSUN_PKG) : ROOT;
const SYSTEM_PROMPT = process.env.PI_SITE_SYSTEM_PROMPT || "";
const CODING_AGENT_DIR = join(ROOT, ".bosun-home", ".pi", "agent");
const HEARTBEAT_MS = Number(process.env.PI_SITE_HEARTBEAT_MS || "2000");
const REPLY_WAIT_TIMEOUT_MS = Number(process.env.PI_SITE_REPLY_WAIT_TIMEOUT_MS || "180000");
const REPLY_WAIT_POLL_MS = Number(process.env.PI_SITE_REPLY_WAIT_POLL_MS || "700");

let backendCache: ProcessBackend | undefined;

function stateDir(): string {
  return process.env.PI_SITE_STATE_DIR || "";
}

function inboxPath(): string {
  return process.env.PI_SITE_INBOX_FILE || "";
}

function outboxPath(): string {
  return process.env.PI_SITE_OUTBOX_FILE || "";
}

function repliesPath(): string {
  return process.env.PI_SITE_REPLIES_FILE || "";
}

function hostSessionName(): string {
  return process.env.PI_SITE_SESSION_NAME?.trim() || "";
}

function defaultAgentName(): string {
  return process.env.PI_SITE_AGENT_NAME || process.env.PI_AGENT || "bosun";
}

function automationAgentName(): string {
  return process.env.PI_SITE_AUTOMATION_AGENT_NAME?.trim() || "";
}

function automationActions(): Set<string> {
  return new Set(
    (process.env.PI_SITE_AUTOMATION_ACTIONS || "maintenance-pulse,surface-review")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function configuredActionAgents(): Map<string, string> {
  const routes = new Map<string, string>();
  const raw = process.env.PI_SITE_ACTION_AGENTS?.trim();

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [actionName, agentName] of Object.entries(parsed || {})) {
        if (typeof agentName !== "string") continue;
        const action = actionName.trim();
        const agent = agentName.trim();
        if (!action || !agent) continue;
        routes.set(action, agent);
      }
    } catch {
      // ignore malformed overrides
    }
  }

  const automationAgent = automationAgentName();
  if (automationAgent) {
    for (const actionName of automationActions()) {
      if (!routes.has(actionName)) routes.set(actionName, automationAgent);
    }
  }

  return routes;
}

function browserMessageHandlerPath(): string {
  return process.env.PI_SITE_BROWSER_MESSAGE_HANDLER?.trim() || "";
}

function browserMessageHandlerTimeoutMs(): number {
  return Number(process.env.PI_SITE_BROWSER_MESSAGE_HANDLER_TIMEOUT_MS || "15000");
}

function spawnEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function runtimeStatePath(): string {
  return join(stateDir(), "agent-runtime-state.json");
}

function defaultSessionPath(): string {
  return join(stateDir(), "pi-agent-session.jsonl");
}

function ensureRequiredEnv(): void {
  if (!stateDir() || !inboxPath() || !outboxPath() || !repliesPath()) {
    throw new Error("pi-agent-queue-runtime missing required env: PI_SITE_STATE_DIR / PI_SITE_INBOX_FILE / PI_SITE_OUTBOX_FILE / PI_SITE_REPLIES_FILE");
  }
}

function ensureStateDir(): void {
  ensureRequiredEnv();
  mkdirSync(stateDir(), { recursive: true });
  if (!existsSync(inboxPath())) writeQueue(inboxPath(), []);
  if (!existsSync(outboxPath())) writeQueue(outboxPath(), []);
  if (!existsSync(repliesPath())) writeQueue(repliesPath(), []);
}

function runtimeBackend(): ProcessBackend {
  if (backendCache) return backendCache;
  const config = loadAgentsConfig(ROOT);
  backendCache = createBackendContract({ cwd: ROOT, backend: config.backend });
  return backendCache;
}

export function setRuntimeBackendForTest(backend?: ProcessBackend): void {
  backendCache = backend;
}

function readQueue(path: string): SiteMessage[] {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SiteMessage[];
  } catch {
    return [];
  }
}

function writeQueue(path: string, messages: SiteMessage[]): void {
  writeFileSync(path, `${JSON.stringify(messages, null, 2)}\n`, "utf-8");
}

function writeRuntimeState(routes: QueueRoutingDecision[]): void {
  ensureStateDir();
  const payload: RuntimeStateRecord = {
    version: 1,
    updatedAt: new Date().toISOString(),
    hostSessionName: hostSessionName() || null,
    backendType: runtimeBackend().type,
    routes: routes
      .map((route) => ({
        agentName: route.agentName,
        tmuxSessionName: route.tmuxSessionName,
        sessionPath: route.sessionPath,
        mode: route.mode,
        backendTarget: route.backendTarget,
      }))
      .sort((a, b) => a.tmuxSessionName.localeCompare(b.tmuxSessionName)),
  };
  writeFileSync(runtimeStatePath(), `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

function createReply(content: string, source: SiteMessage): SiteMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content,
    ts: new Date().toISOString(),
    source: "runtime",
    actorId: source.actorId,
    actorLogin: source.actorLogin,
    visibility: source.visibility,
  };
}

function safeAgentSlug(agentName: string): string {
  const slug = agentName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "agent";
}

function tmuxSessionNameForAgent(agentName: string): string {
  const prefix = process.env.PI_SITE_AGENT_SESSION_PREFIX?.trim() || hostSessionName() || "pi-site-agent";
  return `${prefix}-${safeAgentSlug(agentName)}`;
}

function sessionPathForAgent(agentName: string): string {
  const sessionPath = defaultSessionPath();
  if (agentName === defaultAgentName()) return sessionPath;
  const base = basename(sessionPath, ".jsonl");
  return join(stateDir(), `${base}-${safeAgentSlug(agentName)}.jsonl`);
}

const agentRuntimeOptionsCache = new Map<string, AgentRuntimeOptions>();

function resolveAgentRuntimeOptions(agentName: string): AgentRuntimeOptions {
  const cached = agentRuntimeOptionsCache.get(agentName);
  if (cached) return cached;

  try {
    const spec = buildLaunchSpec(ROOT, { agentName });
    const resolved = {
      model: spec.model,
      thinking: spec.thinking,
    } satisfies AgentRuntimeOptions;
    agentRuntimeOptionsCache.set(agentName, resolved);
    return resolved;
  } catch {
    const resolved = {} satisfies AgentRuntimeOptions;
    agentRuntimeOptionsCache.set(agentName, resolved);
    return resolved;
  }
}

export function parseStructuredSiteAction(content: string): StructuredSiteAction | null {
  if (!content.startsWith("Site action for ")) return null;
  const marker = "\n\nTreat this as a structured browser event against the maintained website surface.";
  const markerIndex = content.indexOf(marker);
  const jsonStart = content.indexOf("\n\n{");
  if (jsonStart === -1 || markerIndex === -1 || markerIndex <= jsonStart + 2) return null;

  try {
    return JSON.parse(content.slice(jsonStart + 2, markerIndex)) as StructuredSiteAction;
  } catch {
    return null;
  }
}

export function formatMessageForAgent(message: SiteMessage): string {
  if (message.role !== "user" || message.source !== "browser") return message.content;

  return [
    "Website user turn:",
    JSON.stringify({
      type: "website-user-message",
      messageId: message.id,
      role: message.role,
      source: message.source,
      ts: message.ts,
      actorId: message.actorId || null,
      actorLogin: message.actorLogin || null,
      visibility: message.visibility || null,
    }, null, 2),
    "User says:",
    message.content,
  ].join("\n\n");
}

export function runBrowserMessageHandler(message: SiteMessage): string | null {
  if (message.role !== "user" || message.source !== "browser") return null;
  const handlerPath = browserMessageHandlerPath();
  if (!handlerPath) return null;

  const args = [handlerPath, "--message-id", message.id, "--content", message.content, "--ts", message.ts];
  if (message.actorId) args.push("--actor-id", message.actorId);
  if (message.actorLogin) args.push("--actor-login", message.actorLogin);
  if (message.visibility) args.push("--visibility", message.visibility);

  const timeoutMs = browserMessageHandlerTimeoutMs();
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: timeoutMs,
    env: spawnEnvironment(),
  });

  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      throw new BrowserMessageHandlerError(`browser message handler timed out after ${timeoutMs}ms`);
    }
    throw new BrowserMessageHandlerError("browser message handler execution failed");
  }

  const stdout = result.stdout.trim();
  if (result.status !== 0) {
    throw new BrowserMessageHandlerError(`browser message handler exited with status ${result.status ?? "unknown"}`);
  }
  if (!stdout) return null;

  let parsed: BrowserMessageHandlerResult;
  try {
    parsed = JSON.parse(stdout) as BrowserMessageHandlerResult;
  } catch {
    throw new BrowserMessageHandlerError("browser message handler emitted invalid JSON");
  }

  if (!parsed.handled) return null;
  if (typeof parsed.reply !== "string" || !parsed.reply.trim()) {
    throw new BrowserMessageHandlerError("browser message handler reported handled=true without a reply");
  }
  return parsed.reply.trim();
}

export function replyTextForRuntimeError(error: unknown): string {
  if (error instanceof BrowserMessageHandlerError) return error.publicMessage;
  const detail = error instanceof Error ? error.message : String(error);
  return `Steward runtime error: ${detail}`;
}

export function selectRoutingForMessage(message: SiteMessage): QueueRoutingDecision {
  const action = message.role === "system" ? parseStructuredSiteAction(message.content) : null;
  const actionName = action?.type === "site-action" && typeof action.action === "string"
    ? action.action.trim()
    : undefined;
  const routedAgent = actionName ? configuredActionAgents().get(actionName) : undefined;

  if (routedAgent) {
    return {
      agentName: routedAgent,
      sessionPath: sessionPathForAgent(routedAgent),
      tmuxSessionName: tmuxSessionNameForAgent(routedAgent),
      mode: "automation",
      actionName,
    };
  }

  const agentName = defaultAgentName();
  return {
    agentName,
    sessionPath: sessionPathForAgent(agentName),
    tmuxSessionName: tmuxSessionNameForAgent(agentName),
    mode: "default",
    actionName,
  };
}

function parseTextSignature(textSignature: string | undefined): { phase?: string } | null {
  if (!textSignature) return null;
  try {
    return JSON.parse(textSignature) as { phase?: string };
  } catch {
    return null;
  }
}

function extractAssistantReply(parts: SessionTextPart[] | undefined): string | null {
  if (!Array.isArray(parts)) return null;
  const textParts = parts.filter((part) => part?.type === "text" && typeof part.text === "string");
  for (const part of textParts) {
    if (parseTextSignature(part.textSignature)?.phase === "final_answer") {
      return part.text!.trim() || null;
    }
  }
  for (let index = textParts.length - 1; index >= 0; index -= 1) {
    const text = textParts[index]?.text?.trim();
    if (text) return text;
  }
  return null;
}

function sessionReplySnapshot(sessionPath: string): SessionReplySnapshot {
  if (!existsSync(sessionPath)) return { replyCount: 0, latestReply: null };

  let replyCount = 0;
  let latestReply: string | null = null;

  for (const line of readFileSync(sessionPath, "utf-8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        type?: string;
        message?: {
          role?: string;
          content?: SessionTextPart[];
        };
      };
      if (event.type !== "message" || event.message?.role !== "assistant") continue;
      const text = extractAssistantReply(event.message.content);
      if (!text) continue;
      replyCount += 1;
      latestReply = text;
    } catch {
      // ignore malformed session lines
    }
  }

  return {
    replyCount,
    latestReply,
  };
}

export function latestAssistantReplyFromSession(sessionPath: string): string | null {
  return sessionReplySnapshot(sessionPath).latestReply;
}

export function assistantReplyCountFromSession(sessionPath: string): number {
  return sessionReplySnapshot(sessionPath).replyCount;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function routeMetadataKey(sessionName: string): string {
  return `bosun.gateway.route.${sessionName}`;
}

async function resolveRoutingTarget(routing: QueueRoutingDecision): Promise<string> {
  if (routing.backendTarget) return routing.backendTarget;

  const backend = runtimeBackend();
  if (backend.type === "tmux") {
    routing.backendTarget = routing.tmuxSessionName;
    return routing.backendTarget;
  }

  const fromMetadata = await backend.readMetadata(routeMetadataKey(routing.tmuxSessionName)).catch(() => null);
  if (fromMetadata) {
    routing.backendTarget = fromMetadata;
    return fromMetadata;
  }

  const resolved = await backend.resolvePaneTargetForSession(routing.tmuxSessionName);
  if (!resolved) {
    throw new Error(`No backend target resolved for session '${routing.tmuxSessionName}'.`);
  }

  routing.backendTarget = resolved;
  await backend.writeMetadata(routeMetadataKey(routing.tmuxSessionName), resolved).catch(() => undefined);
  return resolved;
}

function buildAgentLaunchCommand(routing: QueueRoutingDecision): string {
  const runtime = resolveAgentRuntimeOptions(routing.agentName);
  const args = ["pi", "--session", routing.sessionPath];
  if (runtime.model) args.push("--model", runtime.model);
  if (runtime.thinking) args.push("--thinking", runtime.thinking);
  if (SYSTEM_PROMPT.trim()) args.push("--append-system-prompt", SYSTEM_PROMPT);

  return `cd ${shellEscape(ROOT)} && ${args.map(shellEscape).join(" ")}`;
}

async function ensurePersistentAgentSession(routing: QueueRoutingDecision): Promise<boolean> {
  const backend = runtimeBackend();
  if (await backend.hasSession(routing.tmuxSessionName)) {
    await resolveRoutingTarget(routing).catch(() => undefined);
    return false;
  }

  await backend.startServer();

  const command = buildAgentLaunchCommand(routing);
  const runtimeSlug = safeAgentSlug(routing.agentName);
  const spawned = await backend.spawnDetached({
    createSession: true,
    sessionName: routing.tmuxSessionName,
    windowName: runtimeSlug,
    paneName: runtimeSlug,
    command,
    cwd: ROOT,
    env: {
      PI_CODING_AGENT_DIR: CODING_AGENT_DIR,
      PI_AGENT: routing.agentName,
      PI_AGENT_NAME: routing.tmuxSessionName,
      PI_RUNTIME_BACKEND: backend.type,
      PI_BACKEND_SESSION: routing.tmuxSessionName,
      PI_BACKEND_TARGET: runtimeSlug,
      BOSUN_ROOT: ROOT,
      BOSUN_PKG,
    },
    metadata: {
      [routeMetadataKey(routing.tmuxSessionName)]: routing.tmuxSessionName,
    },
  });

  routing.backendTarget = spawned.paneId || spawned.target || routing.tmuxSessionName;
  await backend.writeMetadata(routeMetadataKey(routing.tmuxSessionName), routing.backendTarget).catch(() => undefined);

  console.log(
    `[pi-agent-queue-runtime] started persistent agent session mode=${routing.mode} agent=${routing.agentName} backend=${backend.type} runtime=${routing.tmuxSessionName} target=${routing.backendTarget} session=${routing.sessionPath}`,
  );

  return true;
}

function agentSessionLooksReady(output: string): boolean {
  return output.includes("mesh:") || output.includes("$0.");
}

async function waitForAgentSessionReady(routing: QueueRoutingDecision): Promise<void> {
  const backend = runtimeBackend();
  const target = await resolveRoutingTarget(routing);

  await backend.awaitReady(target, {
    timeoutMs: 15_000,
    pollMs: 250,
  });

  if (backend.type !== "tmux") return;

  // Keep legacy tmux bootstrap check for reference behavior.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!await backend.hasSession(routing.tmuxSessionName)) return;
    const capture = await backend.captureTail(target, { lines: 120 });
    if (agentSessionLooksReady(capture.text)) return;
    await sleep(250);
  }

  await sleep(1_000);
}

export async function waitForAgentSessionReadyForTest(routing: QueueRoutingDecision): Promise<void> {
  await waitForAgentSessionReady(routing);
}

async function dispatchToAgentSession(routing: QueueRoutingDecision, content: string): Promise<void> {
  const backend = runtimeBackend();
  const target = await resolveRoutingTarget(routing);
  await backend.sendText(target, content);
  await backend.sendKey(target, "Enter");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForStructuredReply(routing: QueueRoutingDecision, baselineReplyCount: number): Promise<string | null> {
  const backend = runtimeBackend();
  const deadline = Date.now() + REPLY_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const snapshot = sessionReplySnapshot(routing.sessionPath);
    if (snapshot.replyCount > baselineReplyCount && snapshot.latestReply) {
      return snapshot.latestReply;
    }

    if (!await backend.hasSession(routing.tmuxSessionName)) {
      return `Steward runtime error: persistent session '${routing.tmuxSessionName}' exited before emitting a structured reply.`;
    }

    await sleep(REPLY_WAIT_POLL_MS);
  }

  return null;
}

async function invokePersistentPi(content: string, routing: QueueRoutingDecision): Promise<string> {
  const backend = runtimeBackend();
  const runtime = resolveAgentRuntimeOptions(routing.agentName);
  const created = await ensurePersistentAgentSession(routing);
  if (created) {
    await waitForAgentSessionReady(routing);
  }
  const baseline = sessionReplySnapshot(routing.sessionPath);

  const startedAt = Date.now();
  await dispatchToAgentSession(routing, content);
  const reply = await waitForStructuredReply(routing, baseline.replyCount);
  const durationMs = Date.now() - startedAt;

  console.log(
    `[pi-agent-queue-runtime] completed mode=${routing.mode} agent=${routing.agentName} action=${routing.actionName || "-"} backend=${backend.type} runtime=${routing.tmuxSessionName} target=${routing.backendTarget || "-"} model=${runtime.model || "-"} thinking=${runtime.thinking || "-"} durationMs=${durationMs}`,
  );

  if (reply) return reply;
  return `Steward runtime timed out waiting for a structured reply from '${routing.tmuxSessionName}' after ${REPLY_WAIT_TIMEOUT_MS}ms.`;
}

let busy = false;
const knownRoutes = new Map<string, QueueRoutingDecision>();

function rememberRoute(route: QueueRoutingDecision): void {
  knownRoutes.set(route.agentName, route);
  writeRuntimeState(Array.from(knownRoutes.values()));
}

async function processInbox(): Promise<void> {
  if (busy) return;
  ensureStateDir();
  const inbox = readQueue(inboxPath());
  if (inbox.length === 0) return;

  busy = true;
  writeQueue(inboxPath(), []);

  try {
    const replies = readQueue(repliesPath());
    for (const message of inbox) {
      const routing = selectRoutingForMessage(message);
      rememberRoute(routing);

      console.log(
        `[pi-agent-queue-runtime] processing ${message.role} ${message.id} mode=${routing.mode} agent=${routing.agentName} runtime=${routing.tmuxSessionName} action=${routing.actionName || "-"}`,
      );

      try {
        const directReply = runBrowserMessageHandler(message);
        if (directReply) {
          replies.push(createReply(directReply, message));
          continue;
        }

        replies.push(createReply(await invokePersistentPi(formatMessageForAgent(message), routing), message));
      } catch (error) {
        replies.push(createReply(replyTextForRuntimeError(error), message));
      }
    }

    writeQueue(repliesPath(), replies);
    writeRuntimeState(Array.from(knownRoutes.values()));
  } finally {
    busy = false;
  }
}

export function startQueueRuntime(): void {
  ensureRequiredEnv();
  const backend = runtimeBackend();

  const defaultRoute = selectRoutingForMessage({
    id: "default-bootstrap",
    role: "user",
    content: "bootstrap",
    ts: new Date().toISOString(),
    source: "gateway",
  });
  rememberRoute(defaultRoute);

  for (const agentName of new Set(configuredActionAgents().values())) {
    rememberRoute({
      agentName,
      sessionPath: sessionPathForAgent(agentName),
      tmuxSessionName: tmuxSessionNameForAgent(agentName),
      mode: "automation",
    });
  }

  console.log(`[pi-agent-queue-runtime] started for agent ${defaultAgentName()}`);
  console.log(`[pi-agent-queue-runtime] backend=${backend.type}`);
  console.log(`[pi-agent-queue-runtime] root=${ROOT}`);
  console.log(`[pi-agent-queue-runtime] coding-agent-dir=${CODING_AGENT_DIR}`);
  console.log(`[pi-agent-queue-runtime] host-session=${hostSessionName() || "(none)"}`);
  console.log(`[pi-agent-queue-runtime] reply-timeout-ms=${REPLY_WAIT_TIMEOUT_MS}`);
  const actionAgents = Array.from(configuredActionAgents().entries())
    .map(([actionName, agentName]) => `${actionName}→${agentName}`)
    .join(",");
  if (actionAgents) {
    console.log(`[pi-agent-queue-runtime] action-agents=${actionAgents}`);
  }

  setInterval(() => {
    void processInbox();
    console.log(`[pi-agent-queue-runtime] heartbeat ${new Date().toISOString()}`);
  }, HEARTBEAT_MS);
}

if (import.meta.main) {
  try {
    startQueueRuntime();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
