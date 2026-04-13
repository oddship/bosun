#!/usr/bin/env bun

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { attach, createWindowTarget } from "../../cdp-browser/scripts/cdp-client.ts";
import {
  assertReviewEvent,
  createReviewId,
  nowIso,
  type ReviewEvent,
  type ReviewSession,
  type ReviewSourceScope,
  type ReviewThread,
  type ReviewThreadStatus,
} from "./session-types.ts";
import {
  createInitialSession,
  getReviewSessionPaths,
  listSessionPayload,
  loadSession,
  persistBatchSubmission,
  persistThreadReply,
  persistThreadStatus,
  readReviewSession,
  resolveReviewRoot,
  resolveSessionDir,
  reviewSessionExists,
  updateReviewSession,
  type ReviewStateOptions,
} from "./review-state.ts";
import { collectInitialDiffScope, loadRoundFilePair } from "./git-review-data.ts";

interface MeshMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: string;
  urgent: boolean;
  replyTo: string | null;
}

interface ReviewMessage {
  id: string;
  author: string;
  role: "reviewer" | "agent" | "system";
  body: string;
  timestamp: string;
}

interface UiReviewThread extends ReviewThread {
  messages: ReviewMessage[];
}

interface FilePairPayload {
  path: string;
  displayPath: string;
  status: string;
  originalContent: string;
  modifiedContent: string;
  language?: string;
  hint?: string;
  reviewed?: boolean;
}

interface DraftCommentPayload {
  id: string;
  kind: "inline" | "file";
  path: string;
  mode: "delta" | "cumulative" | "initial";
  roundId: string | null;
  side: "original" | "modified" | "file";
  startLine: number | null;
  endLine: number | null;
  body: string;
}

interface BridgeSessionState {
  reviewedPaths: string[];
}

type BrowserClient = Awaited<ReturnType<typeof attach>>;
type ViewMode = "delta" | "cumulative" | "initial";

process.on("unhandledRejection", (error) => {
  console.error(error);
  process.exitCode = 1;
});

const { values: args } = parseArgs({
  options: {
    repo: { type: "string" },
    "target-agent": { type: "string" },
    scope: { type: "string", default: "worktree" },
    "base-ref": { type: "string" },
    "head-ref": { type: "string" },
    path: { type: "string", multiple: true },
    label: { type: "string" },
    title: { type: "string" },
    session: { type: "string" },
    port: { type: "string", default: "0" },
    host: { type: "string", default: "127.0.0.1" },
    "cdp-host": { type: "string", default: process.env.CDP_HOST ?? "localhost" },
    "cdp-port": { type: "string", default: process.env.CDP_PORT ?? "9222" },
    width: { type: "string", default: "1680" },
    height: { type: "string", default: "1020" },
  },
  strict: false,
});

const repoRoot = resolveRepoRoot(args.repo ? path.resolve(args.repo) : process.cwd());
const targetAgent = args["target-agent"] ?? process.env.PI_AGENT_NAME ?? "bosun-diff-review";
const scope = parseScope(args);
const projectRoot = findProjectRoot(repoRoot);
const reviewRoot = resolveReviewRoot({ projectRoot });
const requestedSessionDir = args.session
  ? resolveSessionDir(args.session, { projectRoot })
  : path.join(reviewRoot, createReviewId("session"));
const stateOptions: ReviewStateOptions = {
  projectRoot,
  reviewRoot: path.dirname(requestedSessionDir),
};
const sessionId = path.basename(requestedSessionDir);
const sessionPaths = getReviewSessionPaths(sessionId, stateOptions);
const meshDir = path.join(projectRoot, ".pi", "mesh");
const registryDir = path.join(meshDir, "registry");
const inboxDir = path.join(meshDir, "inbox");
const bridgeAgent = `browser-diff-review-${sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(-10)}`;
const ownInbox = path.join(inboxDir, bridgeAgent);
const lockfilePath = path.join(meshDir, `${bridgeAgent}.pid`);
const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const host = args.host ?? "127.0.0.1";
const cdpHost = args["cdp-host"] ?? "localhost";
const cdpPort = Number(args["cdp-port"] ?? 9222);
const windowWidth = Number(args.width ?? 1680);
const windowHeight = Number(args.height ?? 1020);

let currentBrowser: BrowserClient | null = null;
let watcher: fs.FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let server: Server | null = null;
let cleanedUp = false;
let latestRoundReady = false;

validateTargetAgent(targetAgent, registryDir);
claimLock(lockfilePath);
registerInMesh();

let sessionState = ensureInitialSession();

server = Bun.serve({
  hostname: host,
  port: Number(args.port ?? 0),
  fetch: handleHttpRequest,
});

const { targetId: browserTargetId } = await createWindowTarget({
  host: cdpHost,
  port: cdpPort,
  timeout: 15_000,
  url: `http://${host}:${server.port}/`,
  width: windowWidth,
  height: windowHeight,
});
currentBrowser = await attach(browserTargetId, {
  host: cdpHost,
  port: cdpPort,
  timeout: 15_000,
});
await setupBrowserBinding(currentBrowser);
watchInbox();
await processInbox();

console.log("Bosun diff review bridge ready.");
console.log(`Session: ${sessionId}`);
console.log(`Repo: ${repoRoot}`);
console.log(`Target agent: ${targetAgent}`);
console.log(`Bridge agent: ${bridgeAgent}`);
console.log(`URL: http://${host}:${server.port}/`);

process.on("SIGINT", () => {
  cleanup().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  cleanup().finally(() => process.exit(0));
});
process.on("exit", () => {
  if (!cleanedUp) {
    try { fs.unlinkSync(lockfilePath); } catch {}
    try { fs.unlinkSync(path.join(registryDir, `${bridgeAgent}.json`)); } catch {}
  }
});

async function handleHttpRequest(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        sessionId,
        bridgeAgent,
        targetAgent,
        latestRoundReady,
        uptime: Math.floor(process.uptime()),
      });
    }
    if (url.pathname === "/api/session") {
      return Response.json(buildSessionPayload());
    }
    if (url.pathname === "/api/file") {
      const requestedPath = url.searchParams.get("path");
      const mode = normalizeViewMode(url.searchParams.get("mode") ?? "delta");
      const roundId = url.searchParams.get("roundId") || undefined;
      if (!requestedPath) return new Response("Missing path", { status: 400 });

      let normalizedPath: string;
      try {
        normalizedPath = normalizeRequestedRepoPath(requestedPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(message, { status: 400 });
      }

      return Response.json(loadFilePair(normalizedPath, mode, roundId));
    }
    if (url.pathname === "/") {
      return new Response(Bun.file(path.join(webDir, "index.html")), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/app.js") {
      return new Response(Bun.file(path.join(webDir, "app.js")), {
        headers: { "content-type": "application/javascript; charset=utf-8" },
      });
    }
    return new Response("Not found", { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(message, { status: 500 });
  }
}

function parseScope(values: typeof args): ReviewSourceScope {
  const kind = String(values.scope ?? "worktree").trim().toLowerCase();
  const paths = Array.isArray(values.path)
    ? values.path.map((entry) => String(entry).trim()).filter(Boolean)
    : [];

  if (kind === "staged") return { kind: "staged", paths: paths.length ? paths : undefined };
  if (kind === "last-commit") return { kind: "last-commit", paths: paths.length ? paths : undefined };
  if (kind === "commit-range") {
    return {
      kind: "commit-range",
      baseRef: values["base-ref"] ?? undefined,
      headRef: values["head-ref"] ?? undefined,
      paths: paths.length ? paths : undefined,
      label: values.label ?? undefined,
    };
  }
  if (kind === "custom") {
    return {
      kind: "custom",
      baseRef: values["base-ref"] ?? undefined,
      headRef: values["head-ref"] ?? undefined,
      paths: paths.length ? paths : undefined,
      label: values.label ?? undefined,
    };
  }
  return { kind: "worktree", paths: paths.length ? paths : undefined };
}

function normalizeViewMode(value: string): ViewMode {
  if (value === "cumulative") return "cumulative";
  if (value === "initial") return "initial";
  return "delta";
}

function normalizeRequestedRepoPath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  if (!normalized || normalized === ".") {
    throw new Error(`Invalid repository-relative path: ${value}`);
  }
  if (path.posix.isAbsolute(normalized)) {
    throw new Error(`Absolute paths are not allowed: ${value}`);
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Path escapes repository root: ${value}`);
  }
  return normalized;
}

function resolveRepoRoot(cwd: string): string {
  const result = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (!result.ok) throw new Error(`Not inside a git repository: ${cwd}`);
  return result.stdout.trim();
}

function findProjectRoot(start: string): string {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".pi"))) return dir;
    dir = path.dirname(dir);
  }
  return start;
}

function validateTargetAgent(name: string, registryRoot: string): void {
  const regPath = path.join(registryRoot, `${name}.json`);
  if (!fs.existsSync(regPath)) {
    throw new Error(`Target agent '${name}' is not registered in mesh.`);
  }
  const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
  if (typeof reg.pid === "number") {
    process.kill(reg.pid, 0);
  }
}

function claimLock(lockPath: string): void {
  ensureDirSync(path.dirname(lockPath));
  if (fs.existsSync(lockPath)) {
    const existing = Number(fs.readFileSync(lockPath, "utf8").trim());
    if (Number.isFinite(existing) && existing > 0) {
      try {
        process.kill(existing, 0);
        throw new Error(`Bridge already running for ${bridgeAgent} (PID ${existing}).`);
      } catch (error) {
        if (!(error instanceof Error) || !/already running/.test(error.message)) {
          // stale pid
        } else {
          throw error;
        }
      }
    }
  }
  fs.writeFileSync(lockPath, String(process.pid));
}

function registerInMesh(): void {
  ensureDirSync(registryDir);
  ensureDirSync(ownInbox);
  const now = nowIso();
  fs.writeFileSync(
    path.join(registryDir, `${bridgeAgent}.json`),
    JSON.stringify({
      name: bridgeAgent,
      agentType: "browser-review",
      pid: process.pid,
      sessionId,
      cwd: repoRoot,
      model: "bridge",
      startedAt: now,
      isHuman: false,
      session: { toolCalls: 0, tokens: 0, filesModified: [] },
      activity: { lastActivityAt: now },
    }, null, 2),
  );
}

function updateActivity(): void {
  const regPath = path.join(registryDir, `${bridgeAgent}.json`);
  if (!fs.existsSync(regPath)) return;
  const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
  reg.activity = reg.activity || {};
  reg.activity.lastActivityAt = nowIso();
  fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
}

function ensureInitialSession(): ReviewSession {
  if (reviewSessionExists(sessionId, stateOptions)) {
    const existing = readReviewSession(sessionId, stateOptions);
    if (path.resolve(existing.repoRoot) !== repoRoot) {
      throw new Error(`Session ${sessionId} belongs to ${existing.repoRoot}, not ${repoRoot}`);
    }
    if (existing.targetAgent !== targetAgent) {
      throw new Error(`Session ${sessionId} targets ${existing.targetAgent}, not ${targetAgent}`);
    }
    ensureBridgeState();
    if (existing.bridgeAgent !== bridgeAgent) {
      return updateReviewSession(
        sessionId,
        (current) => ({
          ...current,
          bridgeAgent,
        }),
        stateOptions,
      );
    }
    return existing;
  }

  const initial = collectInitialDiffScope({
    sessionId,
    repoRoot,
    scope,
    summary: initialRoundSummary(scope),
    requestedBy: targetAgent,
    state: stateOptions,
  });

  const created = createInitialSession({
    sessionDir: sessionPaths.sessionDir,
    repoRoot,
    targetAgent,
    bridgeAgent,
    title: args.title || `Diff review • ${path.basename(repoRoot)}`,
    initialRound: initial.round,
    baselineSnapshotId: initial.baseSnapshot.id,
  });
  ensureBridgeState();
  return created.session;
}

function initialRoundSummary(sourceScope: ReviewSourceScope): string {
  switch (sourceScope.kind) {
    case "last-commit":
      return "Initial review of the last commit.";
    case "staged":
      return "Initial review of the staged diff.";
    case "commit-range":
      return `Initial review of commit range ${sourceScope.baseRef ?? "?"}..${sourceScope.headRef ?? "?"}.`;
    case "custom":
      return `Initial review of ${describeScope(sourceScope)}.`;
    case "worktree":
    default:
      return "Initial review of the working tree diff.";
  }
}

function describeScope(sourceScope: ReviewSourceScope): string {
  const pathSuffix = sourceScope.paths?.length ? ` (${sourceScope.paths.join(", ")})` : "";
  switch (sourceScope.kind) {
    case "staged":
      return `staged diff${pathSuffix}`;
    case "last-commit":
      return `last commit${pathSuffix}`;
    case "commit-range":
      return `commit range ${sourceScope.baseRef ?? "?"}..${sourceScope.headRef ?? "?"}${pathSuffix}`;
    case "custom":
      if (sourceScope.label) return `${sourceScope.label}${pathSuffix}`;
      if (sourceScope.headRef) return `custom diff ${sourceScope.baseRef ?? "HEAD"}..${sourceScope.headRef}${pathSuffix}`;
      return `custom diff ${sourceScope.baseRef ?? "HEAD"} vs worktree${pathSuffix}`;
    case "worktree":
    default:
      return `working tree diff${pathSuffix}`;
  }
}

function buildSessionPayload() {
  const payload = listSessionPayload(sessionPaths.sessionDir, latestRoundReady);
  const loaded = loadSession(sessionPaths.sessionDir);
  const reviewedPaths = new Set<string>([
    ...payload.reviewedPaths,
    ...readBridgeState().reviewedPaths,
  ]);

  const rounds = payload.rounds.map((round, index) => ({ ...round, number: index + 1 }));
  const latestRound = payload.latestRound
    ? rounds.find((round) => round.id === payload.latestRound?.id) ?? { ...payload.latestRound, number: rounds.length || 1 }
    : null;

  return {
    ...payload,
    latestRound,
    rounds,
    files: {
      delta: markReviewed(payload.files.delta, reviewedPaths),
      cumulative: markReviewed(payload.files.cumulative, reviewedPaths),
      initial: markReviewed(payload.files.initial, reviewedPaths),
    },
    threads: loaded.threads
      .map((thread) => materializeThread(thread, loaded.events))
      .sort((a, b) => a.path.localeCompare(b.path) || a.createdAt.localeCompare(b.createdAt)),
    reviewedPaths: [...reviewedPaths].sort((a, b) => a.localeCompare(b)),
  };
}

function markReviewed<T extends { path: string; reviewed?: boolean }>(
  files: T[],
  reviewedPaths: Set<string>,
): T[] {
  return files.map((file) => ({
    ...file,
    reviewed: file.reviewed || reviewedPaths.has(file.path),
  }));
}

function materializeThread(thread: ReviewThread, events: ReviewEvent[]): UiReviewThread {
  const relatedEvents = events
    .filter((event) => event.threadId === thread.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const resolvedThread = relatedEvents.reduce<ReviewThread>((current, event) => {
    if (event.type === "review.thread.reply") {
      return {
        ...current,
        latestRoundId: event.roundId ?? current.latestRoundId,
        status: event.payload.status ?? current.status,
        updatedAt: event.createdAt,
      };
    }

    if (event.type === "review.thread.accept") {
      return {
        ...current,
        status: "accepted",
        updatedAt: event.createdAt,
      };
    }

    if (event.type === "review.thread.reopen") {
      return {
        ...current,
        status: "open",
        updatedAt: event.createdAt,
      };
    }

    if (event.type === "review.thread.addressed") {
      return {
        ...current,
        status: "addressed",
        latestRoundId: event.payload.roundId ?? event.roundId ?? current.latestRoundId,
        updatedAt: event.createdAt,
      };
    }

    return current;
  }, thread);

  return {
    ...resolvedThread,
    messages: buildThreadMessages(relatedEvents),
  };
}

function buildThreadMessages(events: ReviewEvent[]): ReviewMessage[] {
  return events.flatMap((event) => {
    if (event.type === "review.thread.reply") {
      return [{
        id: event.id,
        author: event.actor,
        role: event.actor === bridgeAgent ? "reviewer" : "agent",
        body: event.payload.body,
        timestamp: event.createdAt,
      } satisfies ReviewMessage];
    }

    if (event.type === "review.thread.accept") {
      return [{
        id: event.id,
        author: event.actor,
        role: "system",
        body: event.payload.note?.trim() || "Reviewer accepted this thread.",
        timestamp: event.createdAt,
      } satisfies ReviewMessage];
    }

    if (event.type === "review.thread.reopen") {
      return [{
        id: event.id,
        author: event.actor,
        role: "system",
        body: event.payload.note?.trim() || "Reviewer reopened this thread.",
        timestamp: event.createdAt,
      } satisfies ReviewMessage];
    }

    if (event.type === "review.thread.addressed") {
      return [{
        id: event.id,
        author: event.actor,
        role: "system",
        body: event.payload.note?.trim() || (event.payload.roundId ? `Addressed in ${event.payload.roundId}.` : "Agent marked this thread addressed."),
        timestamp: event.createdAt,
      } satisfies ReviewMessage];
    }

    return [];
  });
}

function loadFilePair(requestedPath: string, mode: ViewMode, explicitRoundId?: string): FilePairPayload {
  const pair = loadRoundFilePair({
    sessionDir: sessionPaths.sessionDir,
    requestedPath,
    mode,
    roundId: explicitRoundId,
  });
  const reviewedPaths = new Set(readBridgeState().reviewedPaths);
  return {
    ...pair,
    reviewed: reviewedPaths.has(pair.path) || reviewedPaths.has(requestedPath),
  };
}

function bridgeStatePath(): string {
  return path.join(sessionPaths.sessionDir, "bridge-state.json");
}

function ensureBridgeState(): void {
  const filePath = bridgeStatePath();
  if (fs.existsSync(filePath)) return;
  writeBridgeState({ reviewedPaths: [] });
}

function readBridgeState(): BridgeSessionState {
  ensureBridgeState();
  const raw = JSON.parse(fs.readFileSync(bridgeStatePath(), "utf8")) as Partial<BridgeSessionState>;
  const reviewedPaths = Array.isArray(raw.reviewedPaths)
    ? raw.reviewedPaths.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    reviewedPaths: [...new Set(reviewedPaths)].sort((a, b) => a.localeCompare(b)),
  };
}

function writeBridgeState(state: BridgeSessionState): void {
  const filePath = bridgeStatePath();
  ensureDirSync(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
}

async function setupBrowserBinding(browser: BrowserClient): Promise<void> {
  await browser.send("Page.enable");
  await browser.send("Runtime.enable");
  await browser.send("Runtime.addBinding", { name: "piDiffReviewSend" });

  browser.on(async (method: string, params: Record<string, unknown>) => {
    if (method === "Page.loadEventFired") {
      try {
        await browser.send("Runtime.addBinding", { name: "piDiffReviewSend" });
      } catch {}
      void pushToBrowser({
        type: "session.updated",
        title: "Round ready",
        summary: "Review UI reloaded.",
        unreadRoundReady: latestRoundReady,
      });
      return;
    }
    if (method !== "Runtime.bindingCalled") return;
    if (params.name !== "piDiffReviewSend") return;
    const payload = typeof params.payload === "string" ? JSON.parse(params.payload) : params.payload;
    await handleBrowserAction(payload);
  });
}

async function handleBrowserAction(payload: unknown): Promise<void> {
  if (!payload || typeof payload !== "object") return;
  updateActivity();

  const action = payload as Record<string, unknown>;

  if (action.type === "review.batch.submit") {
    const rawDrafts = Array.isArray(action.drafts) ? action.drafts as DraftCommentPayload[] : [];
    const drafts = rawDrafts
      .map((draft) => ({
        kind: draft.kind,
        path: draft.path,
        side: draft.side,
        startLine: draft.startLine,
        endLine: draft.endLine,
        body: String(draft.body ?? "").trim(),
      }))
      .filter((draft) => draft.body.length > 0);
    if (drafts.length === 0) return;

    const result = persistBatchSubmission({
      sessionDir: sessionPaths.sessionDir,
      drafts,
      actor: bridgeAgent,
      targetAgent,
      roundId: normalizeRoundId(action.roundId) ?? sessionState.latestRoundId,
    });
    sessionState = result.session;

    sendMeshMessage(
      targetAgent,
      [
        `review.batch.submit session=${sessionId} round=${result.batchEvent.payload.roundId} drafts=${result.batchEvent.payload.draftCount}`,
        `Summary: ${result.batchEvent.summary}`,
        `Payload: ${result.batchEventPath}`,
        `Bridge: ${bridgeAgent}`,
        `SessionDir: ${sessionPaths.sessionDir}`,
      ].join("\n"),
    );

    await pushToBrowser({
      type: "session.updated",
      title: "Batch sent",
      summary: `Sent ${result.batchEvent.payload.draftCount} draft comment(s) to ${targetAgent}.`,
      unreadRoundReady: latestRoundReady,
    });
    return;
  }

  if (action.type === "review.thread.reply") {
    const threadId = String(action.threadId ?? "").trim();
    const body = String(action.body ?? "").trim();
    if (!threadId || !body) return;

    const result = persistThreadReply({
      sessionDir: sessionPaths.sessionDir,
      threadId,
      actor: bridgeAgent,
      body,
      status: normalizeThreadStatus(action.status) ?? undefined,
      roundId: normalizeRoundId(action.roundId) ?? sessionState.latestRoundId,
    });
    sessionState = updateReviewSession(
      sessionId,
      (current) => ({
        ...current,
        status: "waiting",
      }),
      stateOptions,
    );

    sendMeshMessage(
      targetAgent,
      [
        `review.thread.reply session=${sessionId} thread=${threadId}`,
        `Summary: ${result.event.summary}`,
        `Payload: ${result.eventPath}`,
        `Bridge: ${bridgeAgent}`,
        `SessionDir: ${sessionPaths.sessionDir}`,
      ].join("\n"),
    );

    await pushToBrowser({ type: "thread.updated", summary: `Reply sent on ${result.thread.path}.` });
    return;
  }

  if (action.type === "review.thread.accept" || action.type === "review.thread.reopen") {
    const threadId = String(action.threadId ?? "").trim();
    if (!threadId) return;

    const accepted = action.type === "review.thread.accept";
    const result = persistThreadStatus({
      sessionDir: sessionPaths.sessionDir,
      threadId,
      status: accepted ? "accepted" : "open",
      actor: bridgeAgent,
      roundId: sessionState.latestRoundId,
      note: normalizeOptionalString(action.note) ?? undefined,
    });

    sendMeshMessage(
      targetAgent,
      [
        `${result.event.type} session=${sessionId} thread=${threadId}`,
        `Summary: ${result.event.summary}`,
        `Payload: ${result.eventPath}`,
        `Bridge: ${bridgeAgent}`,
        `SessionDir: ${sessionPaths.sessionDir}`,
      ].join("\n"),
    );

    await pushToBrowser({
      type: "thread.updated",
      summary: accepted ? "Thread accepted." : "Thread reopened.",
    });
    return;
  }

  if (action.type === "review.file.reviewed") {
    const reviewedPath = String(action.path ?? "").trim();
    if (!reviewedPath) return;
    const reviewed = Boolean(action.reviewed);
    const bridgeState = readBridgeState();
    const reviewedSet = new Set(bridgeState.reviewedPaths);
    if (reviewed) reviewedSet.add(reviewedPath);
    else reviewedSet.delete(reviewedPath);
    writeBridgeState({ reviewedPaths: [...reviewedSet].sort((a, b) => a.localeCompare(b)) });
    return;
  }
}

function normalizeRoundId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeThreadStatus(value: unknown): ReviewThreadStatus | null {
  if (value === "open" || value === "addressed" || value === "accepted") return value;
  return null;
}

function sendMeshMessage(to: string, text: string): void {
  ensureDirSync(path.join(inboxDir, to));
  const msg: MeshMessage = {
    id: randomUUID(),
    from: bridgeAgent,
    to,
    text,
    timestamp: nowIso(),
    urgent: false,
    replyTo: null,
  };
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  fs.writeFileSync(path.join(inboxDir, to, fileName), JSON.stringify(msg, null, 2));
}

function watchInbox(): void {
  ensureDirSync(ownInbox);
  watcher = fs.watch(ownInbox, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void processInbox();
    }, 60);
  });
}

function extractPayloadPath(text: string): string | null {
  const match = text.match(/^Payload:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function extractSessionId(text: string): string | null {
  const match = text.match(/session=([^\s]+)/);
  return match ? match[1] : null;
}

function parseReviewEventFromFile(filePath: string): ReviewEvent | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return assertReviewEvent(raw, `event:${filePath}`);
  } catch {
    return null;
  }
}

async function processInbox(): Promise<void> {
  if (!fs.existsSync(ownInbox)) return;
  const files = fs.readdirSync(ownInbox).filter((name) => name.endsWith(".json")).sort();
  for (const fileName of files) {
    const filePath = path.join(ownInbox, fileName);
    try {
      const message = JSON.parse(fs.readFileSync(filePath, "utf8")) as MeshMessage;
      const payloadPath = extractPayloadPath(message.text || "");
      const messageSessionId = extractSessionId(message.text || "");
      let title = `Message from ${message.from}`;
      let summary = (message.text || "").slice(0, 280);
      let shouldRefresh = messageSessionId === sessionId || (message.text || "").includes(sessionPaths.sessionDir);

      if (payloadPath && fs.existsSync(payloadPath)) {
        const event = parseReviewEventFromFile(payloadPath);
        if (event) {
          shouldRefresh = shouldRefresh || event.sessionId === sessionId || payloadPath.startsWith(sessionPaths.sessionDir);
          title = titleForEvent(event, message.from);
          summary = event.summary || summary;
          applyIncomingEvent(event);
          if (event.type === "review.round.ready") {
            latestRoundReady = true;
            await pushToBrowser({ type: "round.ready", summary });
          } else {
            await pushToBrowser({ type: "toast", title, message: summary });
          }
        } else {
          await pushToBrowser({ type: "toast", title, message: summary });
        }
      } else {
        await pushToBrowser({ type: "toast", title, message: summary });
      }

      if (shouldRefresh) {
        await pushToBrowser({ type: "session.updated", title, summary, unreadRoundReady: latestRoundReady });
      }
      updateActivity();
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error(error);
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
}

function titleForEvent(event: ReviewEvent, sender: string): string {
  switch (event.type) {
    case "review.round.ready":
      return "New round ready";
    case "review.thread.addressed":
      return "Thread addressed";
    case "review.thread.reply":
      return `Reply from ${sender}`;
    case "review.thread.accept":
      return "Thread accepted";
    case "review.thread.reopen":
      return "Thread reopened";
    case "review.session.close":
      return "Review session closed";
    default:
      return `Message from ${sender}`;
  }
}

function applyIncomingEvent(event: ReviewEvent): void {
  if (event.sessionId !== sessionId) return;

  if (event.type === "review.round.ready") {
    try {
      const current = readReviewSession(sessionId, stateOptions);
      if (current.latestRoundId !== event.payload.roundId || current.status !== "ready") {
        sessionState = updateReviewSession(
          sessionId,
          (session) => ({
            ...session,
            latestRoundId: event.payload.roundId,
            status: "ready",
          }),
          stateOptions,
        );
      } else {
        sessionState = current;
      }
    } catch {
      // ignore
    }
    return;
  }

  if (event.type === "review.session.close") {
    try {
      sessionState = updateReviewSession(
        sessionId,
        (session) => ({
          ...session,
          status: "closed",
        }),
        stateOptions,
      );
    } catch {
      // ignore
    }
  }
}

async function pushToBrowser(payload: Record<string, unknown>): Promise<void> {
  if (!currentBrowser) return;
  const encoded = JSON.stringify(JSON.stringify(payload));
  await currentBrowser.eval(`window.__piDiffReviewReceive && window.__piDiffReviewReceive(${encoded})`);
}

function runGit(cwd: string, args: string[]) {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" });
  return {
    ok: result.exitCode === 0,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function ensureDirSync(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

async function cleanup(): Promise<void> {
  if (cleanedUp) return;
  cleanedUp = true;
  if (debounceTimer) clearTimeout(debounceTimer);
  try { watcher?.close(); } catch {}
  try { currentBrowser?.close(); } catch {}
  try { server?.stop(true); } catch {}
  try { fs.unlinkSync(lockfilePath); } catch {}
  try { fs.unlinkSync(path.join(registryDir, `${bridgeAgent}.json`)); } catch {}
}
