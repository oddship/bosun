#!/usr/bin/env bun

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createWindowTarget } from "../../cdp-browser/scripts/cdp-client.ts";
import { parsePlanAnchors } from "./plan-anchors.ts";
import { buildPlanReviewViewModel, type PlanReviewViewMode } from "./plan-markdown.ts";
import {
  createInitialSession,
  findProjectRoot,
  loadSession,
  persistDraftState,
  persistSubmission,
  publishReround,
  readSnapshotMarkdown,
  resolveReviewRoot,
  resolveSessionDir,
  reviewSessionExists,
} from "./review-state.ts";
import { createPlanReviewId, nowIso, type PlanReviewAnchor } from "./session-types.ts";

interface MeshMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: string;
  urgent: boolean;
  replyTo: string | null;
}

interface SubmissionRequestBody {
  outcome?: unknown;
  summary?: unknown;
  feedback?: unknown;
  globalComment?: unknown;
}

interface DraftStateRequestBody {
  drafts?: unknown;
  globalComment?: unknown;
}

interface ReroundRequestBody {
  planFilePath?: unknown;
  summary?: unknown;
}

interface SubmissionDraft {
  anchor: PlanReviewAnchor;
  comment: string;
  suggestion?: string | null;
  threadId?: string | null;
}

const { values: args } = parseArgs({
  options: {
    plan: { type: "string" },
    session: { type: "string" },
    title: { type: "string" },
    "target-agent": { type: "string" },
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "0" },
    "cdp-host": { type: "string", default: process.env.CDP_HOST ?? "localhost" },
    "cdp-port": { type: "string", default: process.env.CDP_PORT ?? "9222" },
    width: { type: "string", default: "1560" },
    height: { type: "string", default: "980" },
    "no-browser": { type: "boolean", default: false },
  },
  strict: false,
});

const projectRoot = findProjectRoot(process.cwd());
const reviewRoot = resolveReviewRoot({ projectRoot });
const requestedSessionDir = args.session
  ? resolveSessionDir(args.session, { projectRoot })
  : path.join(reviewRoot, createPlanReviewId("session"));
const sessionId = path.basename(requestedSessionDir);
const bridgeAgentSuffix = sessionId
  .replace(/[^a-zA-Z0-9_-]/g, "-")
  .replace(/-+/g, "-")
  .slice(0, 24)
  .replace(/^-+|-+$/g, "");
const bridgeAgent = `browser-plan-review-${bridgeAgentSuffix || "session"}`;
const targetAgent = args["target-agent"] ?? process.env.PI_AGENT_NAME ?? "bosun-plan-review";
const meshDir = path.join(projectRoot, ".pi", "mesh");
const registryDir = path.join(meshDir, "registry");
const inboxDir = path.join(meshDir, "inbox");
const lockfilePath = path.join(meshDir, `${bridgeAgent}.pid`);
const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const host = args.host ?? "127.0.0.1";
const cdpHost = args["cdp-host"] ?? "localhost";
const cdpPort = Number(args["cdp-port"] ?? 9222);
const windowWidth = Number(args.width ?? 1560);
const windowHeight = Number(args.height ?? 980);

let cleanedUp = false;

claimLock(lockfilePath);
registerInMesh();
const boot = ensureSession();

const server = Bun.serve({
  hostname: host,
  port: Number(args.port ?? 0),
  fetch: handleRequest,
});

if (!args["no-browser"]) {
  const url = `http://${host}:${server.port}/`;
  await createWindowTarget({
    host: cdpHost,
    port: cdpPort,
    timeout: 15_000,
    url,
    width: windowWidth,
    height: windowHeight,
  });
}

console.log("Bosun plan review bridge ready.");
console.log(`Session: ${boot.session.id}`);
console.log(`Plan: ${boot.document.planFilePath}`);
console.log(`Target agent: ${boot.session.targetAgent}`);
console.log(`Bridge agent: ${boot.session.bridgeAgent}`);
console.log(`URL: http://${host}:${server.port}/`);

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});
process.on("exit", () => {
  cleanup();
});

function ensureDirSync(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function claimLock(lockPath: string): void {
  ensureDirSync(path.dirname(lockPath));
  if (fs.existsSync(lockPath)) {
    const existingPid = Number(fs.readFileSync(lockPath, "utf8").trim());
    if (Number.isFinite(existingPid)) {
      try {
        process.kill(existingPid, 0);
        throw new Error(`Plan review bridge already running (pid ${existingPid})`);
      } catch (error) {
        if (error instanceof Error && /already running/.test(error.message)) throw error;
      }
    }
  }
  fs.writeFileSync(lockPath, String(process.pid));
}

function registerInMesh(): void {
  ensureDirSync(registryDir);
  ensureDirSync(path.join(inboxDir, bridgeAgent));
  const now = nowIso();
  fs.writeFileSync(
    path.join(registryDir, `${bridgeAgent}.json`),
    JSON.stringify(
      {
        name: bridgeAgent,
        agentType: "browser-review",
        pid: process.pid,
        sessionId,
        cwd: projectRoot,
        model: "bridge",
        startedAt: now,
        isHuman: false,
        session: { toolCalls: 0, tokens: 0, filesModified: [] },
        activity: { lastActivityAt: now },
      },
      null,
      2,
    ),
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

function cleanup(): void {
  if (cleanedUp) return;
  cleanedUp = true;
  try {
    server.stop(true);
  } catch {}
  try {
    fs.unlinkSync(lockfilePath);
  } catch {}
  try {
    fs.unlinkSync(path.join(registryDir, `${bridgeAgent}.json`));
  } catch {}
}

function ensureSession() {
  if (reviewSessionExists(requestedSessionDir, { projectRoot })) {
    const loaded = loadSession(requestedSessionDir, { projectRoot });
    if (args["target-agent"] && loaded.session.targetAgent !== args["target-agent"]) {
      throw new Error(
        `Existing session targets ${loaded.session.targetAgent}, not ${args["target-agent"]}`,
      );
    }
    return loaded;
  }

  const planPath = args.plan?.trim();
  if (!planPath) {
    throw new Error("Missing --plan for new plan review session");
  }

  const created = createInitialSession({
    sessionDir: requestedSessionDir,
    planFilePath: planPath,
    targetAgent,
    bridgeAgent,
    title: args.title?.trim() || undefined,
    actor: bridgeAgent,
    projectRoot,
  });

  return loadSession(created.sessionDir, { projectRoot });
}

function loadCurrent() {
  return loadSession(requestedSessionDir, { projectRoot });
}

function currentMarkdown(current = loadCurrent()): string {
  const snapshotPath = path.join(
    current.paths.snapshotsDir,
    `${current.document.currentSnapshotId}.md`,
  );
  return fs.readFileSync(snapshotPath, "utf-8");
}

function previousAnchorsFor(current = loadCurrent()) {
  if (current.document.snapshots.length < 2) return [];
  const previousSnapshot = current.document.snapshots[current.document.snapshots.length - 2];
  return parsePlanAnchors(
    readSnapshotMarkdown(requestedSessionDir, previousSnapshot.id, { projectRoot }),
  ).anchors;
}

function viewModeFromSearchParam(value: string | null): PlanReviewViewMode {
  return value === "delta" ? "delta" : "full";
}

function globalAnchorFor(current = loadCurrent()): PlanReviewAnchor {
  return {
    id: `anchor_global_${current.document.currentSnapshotId}`,
    headingPath: [],
    blockKind: "global",
    blockIndexPath: [0],
    text: current.document.title,
    quote: null,
    lineStart: null,
    lineEnd: null,
  };
}

function validateSubmissionDrafts(value: unknown): SubmissionDraft[] {
  if (!Array.isArray(value)) {
    throw new Error("feedback must be an array");
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`feedback[${index}] must be an object`);
    }
    const draft = item as Record<string, unknown>;
    const comment = draft.comment;
    if (typeof comment !== "string" || !comment.trim()) {
      throw new Error(`feedback[${index}].comment must be a non-empty string`);
    }
    const anchor = draft.anchor;
    if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
      throw new Error(`feedback[${index}].anchor must be an object`);
    }
    return {
      anchor: anchor as PlanReviewAnchor,
      comment: comment.trim(),
      suggestion:
        typeof draft.suggestion === "string" && draft.suggestion.trim()
          ? draft.suggestion.trim()
          : null,
      threadId:
        typeof draft.threadId === "string" && draft.threadId.trim()
          ? draft.threadId.trim()
          : null,
    };
  });
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

function meshPayloadPath(absolutePath: string): string {
  const relative = path.relative(projectRoot, absolutePath);
  return relative && !relative.startsWith("..") ? relative : absolutePath;
}

function buildResultMessage(params: {
  sessionId: string;
  outcome: string;
  feedbackCount: number;
  summary: string;
  payloadPath: string;
}): string {
  return [
    `plan-review.result session=${params.sessionId} outcome=${params.outcome} feedback=${params.feedbackCount}`,
    `Summary: ${params.summary}`,
    `Payload: ${params.payloadPath}`,
  ].join("\n");
}

async function handleRequest(req: Request): Promise<Response> {
  try {
    updateActivity();
    const url = new URL(req.url);

    if (url.pathname === "/api/health") {
      const current = loadCurrent();
      return Response.json({
        status: "ok",
        sessionId: current.session.id,
        bridgeAgent,
        targetAgent: current.session.targetAgent,
        uptime: Math.floor(process.uptime()),
      });
    }

    if (url.pathname === "/api/session") {
      const current = loadCurrent();
      const previousAnchors = previousAnchorsFor(current);
      const mode = viewModeFromSearchParam(url.searchParams.get("mode"));
      const latestSubmission = current.submissions.find(
        (submission) => submission.id === current.session.latestSubmissionId,
      ) ?? null;
      return Response.json({
        summary: {
          session: current.session,
          document: current.document,
          draftState: current.draftState,
          threadCount: current.threads.length,
          staleThreadCount: current.threads.filter((thread) => thread.stale).length,
          submissionCount: current.submissions.length,
          latestSubmission,
        },
        draftState: current.draftState,
        globalAnchor: globalAnchorFor(current),
        threads: current.threads,
        recentEvents: current.events.slice(-12).reverse(),
        latestSubmission,
        viewModel: buildPlanReviewViewModel(current.session, current.document, {
          mode,
          previousAnchors,
        }),
        markdown: currentMarkdown(current),
      });
    }

    if (url.pathname === "/api/reround" && req.method === "POST") {
      const body = (await req.json()) as ReroundRequestBody;
      const result = publishReround({
        sessionDir: requestedSessionDir,
        actor: bridgeAgent,
        planFilePath:
          typeof body.planFilePath === "string" && body.planFilePath.trim()
            ? body.planFilePath.trim()
            : undefined,
        summary: typeof body.summary === "string" ? body.summary.trim() : undefined,
        projectRoot,
      });

      return Response.json({
        ok: true,
        sessionId,
        snapshotId: result.document.currentSnapshotId,
        deltaCount: result.diff.deltaAnchorIds.length,
        staleThreadCount: result.updatedThreads.filter((thread) => thread.stale).length,
      });
    }

    if (url.pathname === "/api/drafts" && req.method === "POST") {
      const body = (await req.json()) as DraftStateRequestBody;
      const drafts = validateSubmissionDrafts(body.drafts ?? []);
      const current = loadCurrent();
      const validAnchorIds = new Set(current.document.anchors.map((anchor) => anchor.id));
      for (const draft of drafts) {
        if (!validAnchorIds.has(draft.anchor.id)) {
          return new Response(`Unknown anchor id: ${draft.anchor.id}`, { status: 400 });
        }
      }

      const draftState = persistDraftState(
        {
          sessionDir: requestedSessionDir,
          drafts,
          globalComment:
            typeof body.globalComment === "string" ? body.globalComment.trim() : null,
        },
        { projectRoot },
      );

      return Response.json({ ok: true, draftState });
    }

    if (url.pathname === "/api/submission" && req.method === "POST") {
      const body = (await req.json()) as SubmissionRequestBody;
      const outcome = body.outcome;
      if (outcome !== "approve" && outcome !== "request_changes") {
        return new Response("Invalid outcome", { status: 400 });
      }

      const current = loadCurrent();
      const feedback = body.feedback === undefined
        ? current.draftState.drafts
        : validateSubmissionDrafts(body.feedback ?? []);
      const validAnchorIds = new Set(current.document.anchors.map((anchor) => anchor.id));
      const globalAnchor = globalAnchorFor(current);
      for (const draft of feedback) {
        if (draft.anchor.id !== globalAnchor.id && !validAnchorIds.has(draft.anchor.id)) {
          return new Response(`Unknown anchor id: ${draft.anchor.id}`, { status: 400 });
        }
      }

      const globalComment =
        typeof body.globalComment === "string"
          ? body.globalComment.trim()
          : (current.draftState.globalComment ?? "").trim();
      const combinedFeedback = [...feedback];
      if (globalComment) {
        combinedFeedback.push({
          anchor: globalAnchor,
          comment: globalComment,
          suggestion: null,
          threadId: null,
        });
      }

      const result = persistSubmission(
        {
          sessionDir: requestedSessionDir,
          outcome,
          actor: bridgeAgent,
          targetAgent: current.session.targetAgent,
          summary: typeof body.summary === "string" ? body.summary.trim() : undefined,
          feedback: combinedFeedback,
        },
        { projectRoot },
      );

      const payloadPath = meshPayloadPath(result.submissionPath);
      sendMeshMessage(
        current.session.targetAgent,
        buildResultMessage({
          sessionId,
          outcome,
          feedbackCount: result.submission.feedbackCount,
          summary: result.submission.summary,
          payloadPath,
        }),
      );

      return Response.json({
        ok: true,
        sessionId,
        submissionId: result.submission.id,
        payloadPath,
      });
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
