import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { parsePlanAnchors } from "./plan-anchors";
import {
  buildPlanDiff,
  reconcileThreadsForReround,
  type PlanDiffResult,
} from "./plan-diff";
import {
  assertPlanReviewDocument,
  assertPlanReviewEvent,
  assertPlanReviewSession,
  assertPlanReviewSubmission,
  assertPlanReviewThread,
  createPlanReviewDocument,
  createPlanReviewEvent,
  createPlanReviewFeedbackItem,
  createPlanReviewSession,
  createPlanReviewSnapshot,
  createPlanReviewSubmission,
  createPlanReviewThread,
  createPlanReviewId,
  nowIso,
  type PlanReviewAnchor,
  type PlanReviewDocument,
  type PlanReviewEvent,
  type PlanReviewOutcome,
  type PlanReviewSession,
  type PlanReviewSessionStatus,
  type PlanReviewSubmission,
  type PlanReviewThread,
} from "./session-types";

const DEFAULT_REVIEW_ROOT = path.join("workspace", "scratch", "plan-reviews");

export interface ReviewStateOptions {
  projectRoot?: string;
  reviewRoot?: string;
}

export interface PlanReviewSessionPaths {
  reviewRoot: string;
  sessionDir: string;
  sessionFile: string;
  documentFile: string;
  draftStateFile: string;
  threadsDir: string;
  eventsDir: string;
  submissionsDir: string;
  snapshotsDir: string;
}

export interface LoadedPlanReviewSession {
  sessionDir: string;
  paths: PlanReviewSessionPaths;
  session: PlanReviewSession;
  document: PlanReviewDocument;
  draftState: PlanReviewDraftState;
  threads: PlanReviewThread[];
  submissions: PlanReviewSubmission[];
  events: PlanReviewEvent[];
}

export interface SessionSummaryPayload {
  session: PlanReviewSession;
  document: PlanReviewDocument;
  draftState: PlanReviewDraftState;
  threadCount: number;
  submissionCount: number;
  latestSubmission: PlanReviewSubmission | null;
}

export interface CreateInitialSessionInput extends ReviewStateOptions {
  sessionId?: string;
  sessionDir?: string;
  planFilePath: string;
  targetAgent: string;
  bridgeAgent: string;
  title?: string;
  actor?: string;
  status?: PlanReviewSessionStatus;
}

export interface CreateInitialSessionResult {
  sessionDir: string;
  sessionPath: string;
  documentPath: string;
  snapshotPath: string;
  eventPath: string;
  session: PlanReviewSession;
  document: PlanReviewDocument;
}

export interface DraftFeedbackInput {
  anchor: PlanReviewAnchor;
  comment: string;
  suggestion?: string | null;
  threadId?: string | null;
}

export interface PersistedPlanReviewDraft extends DraftFeedbackInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanReviewDraftState {
  schemaVersion: 1;
  kind: "plan-review-drafts";
  sessionId: string;
  globalComment: string | null;
  drafts: PersistedPlanReviewDraft[];
  updatedAt: string;
}

export interface PersistDraftStateInput {
  sessionDir: string;
  drafts: DraftFeedbackInput[];
  globalComment?: string | null;
}

export interface PersistSubmissionInput {
  sessionDir: string;
  outcome: PlanReviewOutcome;
  feedback: DraftFeedbackInput[];
  actor: string;
  targetAgent: string;
  summary?: string;
}

export interface PersistSubmissionResult {
  session: PlanReviewSession;
  submission: PlanReviewSubmission;
  createdThreads: PlanReviewThread[];
  submissionPath: string;
  submissionEventPath: string;
  resultEventPath: string;
}

export interface PublishReroundInput extends ReviewStateOptions {
  sessionDir: string;
  actor: string;
  planFilePath?: string;
  summary?: string;
  status?: PlanReviewSessionStatus;
}

export interface PublishReroundResult {
  session: PlanReviewSession;
  document: PlanReviewDocument;
  snapshotPath: string;
  diff: PlanDiffResult;
  updatedThreads: PlanReviewThread[];
  event: PlanReviewEvent<"review.reround.ready">;
  eventPath: string;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function looksLikePathInput(value: string): boolean {
  return path.isAbsolute(value) || value.includes("/") || value.includes("\\");
}

export function findProjectRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  while (true) {
    const hasGit = fs.existsSync(path.join(current, ".git"));
    const hasPi = fs.existsSync(path.join(current, ".pi"));
    if (hasGit || hasPi) return current;

    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

export function resolveReviewRoot(options: ReviewStateOptions = {}): string {
  const projectRoot = options.projectRoot ?? findProjectRoot();
  const configuredRoot = options.reviewRoot ?? DEFAULT_REVIEW_ROOT;
  return path.isAbsolute(configuredRoot)
    ? configuredRoot
    : path.join(projectRoot, configuredRoot);
}

export function resolveSessionDir(
  sessionIdOrDir: string,
  options: ReviewStateOptions = {},
): string {
  const value = sessionIdOrDir.trim();
  if (!value) throw new Error("session id or directory is required");
  if (looksLikePathInput(value)) return path.resolve(value);
  return path.join(resolveReviewRoot(options), value);
}

export function getReviewSessionPaths(
  sessionId: string,
  options: ReviewStateOptions = {},
): PlanReviewSessionPaths {
  const reviewRoot = resolveReviewRoot(options);
  const sessionDir = path.join(reviewRoot, sessionId);
  return {
    reviewRoot,
    sessionDir,
    sessionFile: path.join(sessionDir, "session.json"),
    documentFile: path.join(sessionDir, "document.json"),
    draftStateFile: path.join(sessionDir, "drafts.json"),
    threadsDir: path.join(sessionDir, "threads"),
    eventsDir: path.join(sessionDir, "events"),
    submissionsDir: path.join(sessionDir, "submissions"),
    snapshotsDir: path.join(sessionDir, "snapshots"),
  };
}

function ensureSessionDirs(paths: PlanReviewSessionPaths): void {
  ensureDir(paths.sessionDir);
  ensureDir(paths.threadsDir);
  ensureDir(paths.eventsDir);
  ensureDir(paths.submissionsDir);
  ensureDir(paths.snapshotsDir);
}

function sanitizeTimestampForFilename(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function writeTextAtomic(targetPath: string, content: string): void {
  ensureDir(path.dirname(targetPath));
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, content, "utf-8");
  fs.renameSync(tempPath, targetPath);
}

function writeJsonAtomic(targetPath: string, value: unknown): void {
  writeTextAtomic(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson<T>(
  targetPath: string,
  assertFn: (value: unknown, label?: string) => asserts value is T,
  label: string,
): T {
  const raw = fs.readFileSync(targetPath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  assertFn(parsed, label);
  return parsed;
}

function assertDraftFeedbackInput(
  value: unknown,
  label: string,
): asserts value is DraftFeedbackInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (!record.anchor || typeof record.anchor !== "object" || Array.isArray(record.anchor)) {
    throw new Error(`${label}.anchor must be an object`);
  }
  if (typeof record.comment !== "string" || !record.comment.trim()) {
    throw new Error(`${label}.comment must be a non-empty string`);
  }
  if (record.suggestion !== undefined && record.suggestion !== null && typeof record.suggestion !== "string") {
    throw new Error(`${label}.suggestion must be a string or null`);
  }
  if (record.threadId !== undefined && record.threadId !== null && typeof record.threadId !== "string") {
    throw new Error(`${label}.threadId must be a string or null`);
  }
}

function createEmptyDraftState(sessionId: string, updatedAt: string = nowIso()): PlanReviewDraftState {
  return {
    schemaVersion: 1,
    kind: "plan-review-drafts",
    sessionId,
    globalComment: null,
    drafts: [],
    updatedAt,
  };
}

function assertDraftState(
  value: unknown,
  label: string = "draftState",
): asserts value is PlanReviewDraftState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) throw new Error(`${label}.schemaVersion must be 1`);
  if (record.kind !== "plan-review-drafts") throw new Error(`${label}.kind must be plan-review-drafts`);
  if (typeof record.sessionId !== "string" || !record.sessionId) {
    throw new Error(`${label}.sessionId must be a non-empty string`);
  }
  if (record.globalComment !== null && record.globalComment !== undefined && typeof record.globalComment !== "string") {
    throw new Error(`${label}.globalComment must be a string or null`);
  }
  if (!Array.isArray(record.drafts)) throw new Error(`${label}.drafts must be an array`);
  record.drafts.forEach((draft, index) => {
    if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
      throw new Error(`${label}.drafts[${index}] must be an object`);
    }
    const item = draft as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id) {
      throw new Error(`${label}.drafts[${index}].id must be a non-empty string`);
    }
    if (typeof item.createdAt !== "string" || !item.createdAt) {
      throw new Error(`${label}.drafts[${index}].createdAt must be a non-empty string`);
    }
    if (typeof item.updatedAt !== "string" || !item.updatedAt) {
      throw new Error(`${label}.drafts[${index}].updatedAt must be a non-empty string`);
    }
    assertDraftFeedbackInput(draft, `${label}.drafts[${index}]`);
  });
  if (typeof record.updatedAt !== "string" || !record.updatedAt) {
    throw new Error(`${label}.updatedAt must be a non-empty string`);
  }
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => path.join(dir, entry));
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function countLines(content: string): number {
  return content.replace(/\r\n?/g, "\n").split("\n").length;
}

function snapshotFilename(snapshotId: string): string {
  return `${snapshotId}.md`;
}

function snapshotStoragePath(snapshotId: string): string {
  return path.join("snapshots", snapshotFilename(snapshotId));
}

function resolveSnapshotPath(paths: PlanReviewSessionPaths, snapshotId: string): string {
  return path.join(paths.snapshotsDir, snapshotFilename(snapshotId));
}

export function readSnapshotMarkdown(
  sessionDir: string,
  snapshotId: string,
  options: ReviewStateOptions = {},
): string {
  const resolved = resolveSessionDir(sessionDir, options);
  const sessionId = path.basename(resolved);
  const paths = getReviewSessionPaths(sessionId, { reviewRoot: path.dirname(resolved) });
  const snapshotPath = resolveSnapshotPath(paths, snapshotId);
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot not found: ${snapshotPath}`);
  }
  return fs.readFileSync(snapshotPath, "utf-8");
}

export function reviewSessionExists(
  sessionIdOrDir: string,
  options: ReviewStateOptions = {},
): boolean {
  const resolved = resolveSessionDir(sessionIdOrDir, options);
  return fs.existsSync(path.join(resolved, "session.json"));
}

export function readReviewSession(
  sessionDir: string,
  options: ReviewStateOptions = {},
): PlanReviewSession {
  const resolved = resolveSessionDir(sessionDir, options);
  return readJson(path.join(resolved, "session.json"), assertPlanReviewSession, "session");
}

export function readReviewDocument(
  sessionDir: string,
  options: ReviewStateOptions = {},
): PlanReviewDocument {
  const resolved = resolveSessionDir(sessionDir, options);
  return readJson(path.join(resolved, "document.json"), assertPlanReviewDocument, "document");
}

export function readDraftState(
  sessionDir: string,
  options: ReviewStateOptions = {},
): PlanReviewDraftState {
  const resolved = resolveSessionDir(sessionDir, options);
  const target = path.join(resolved, "drafts.json");
  if (!fs.existsSync(target)) {
    return createEmptyDraftState(path.basename(resolved));
  }
  return readJson(target, assertDraftState, "draftState");
}

export function writeDraftState(
  sessionDir: string,
  draftState: PlanReviewDraftState,
  options: ReviewStateOptions = {},
): string {
  const resolved = resolveSessionDir(sessionDir, options);
  const target = path.join(resolved, "drafts.json");
  writeJsonAtomic(target, draftState);
  return target;
}

export function persistDraftState(
  input: PersistDraftStateInput,
  options: ReviewStateOptions = {},
): PlanReviewDraftState {
  const resolved = resolveSessionDir(input.sessionDir, options);
  const sessionId = path.basename(resolved);
  const updatedAt = nowIso();
  const draftState: PlanReviewDraftState = {
    schemaVersion: 1,
    kind: "plan-review-drafts",
    sessionId,
    globalComment:
      typeof input.globalComment === "string" && input.globalComment.trim()
        ? input.globalComment.trim()
        : null,
    drafts: input.drafts.map((draft) => ({
      id: createPlanReviewId("draft"),
      anchor: draft.anchor,
      comment: draft.comment.trim(),
      suggestion: draft.suggestion?.trim() || null,
      threadId: draft.threadId ?? null,
      createdAt: updatedAt,
      updatedAt,
    })),
    updatedAt,
  };
  writeDraftState(resolved, draftState, options);
  return draftState;
}

export function writeReviewSession(
  sessionDir: string,
  session: PlanReviewSession,
  options: ReviewStateOptions = {},
): string {
  const resolved = resolveSessionDir(sessionDir, options);
  const target = path.join(resolved, "session.json");
  writeJsonAtomic(target, session);
  return target;
}

export function writeReviewDocument(
  sessionDir: string,
  document: PlanReviewDocument,
  options: ReviewStateOptions = {},
): string {
  const resolved = resolveSessionDir(sessionDir, options);
  const target = path.join(resolved, "document.json");
  writeJsonAtomic(target, document);
  return target;
}

export function appendReviewEvent(
  sessionDir: string,
  event: PlanReviewEvent,
  options: ReviewStateOptions = {},
): string {
  const resolved = resolveSessionDir(sessionDir, options);
  const eventDir = path.join(resolved, "events");
  ensureDir(eventDir);
  const filename = `${sanitizeTimestampForFilename(event.createdAt)}-${event.type.replace(/\./g, "-")}-${event.id}.json`;
  const target = path.join(eventDir, filename);
  writeJsonAtomic(target, event);
  return target;
}

function readThreadFiles(paths: PlanReviewSessionPaths): PlanReviewThread[] {
  return listJsonFiles(paths.threadsDir).map((filePath, index) =>
    readJson(filePath, assertPlanReviewThread, `thread[${index}]`),
  );
}

function readSubmissionFiles(paths: PlanReviewSessionPaths): PlanReviewSubmission[] {
  return listJsonFiles(paths.submissionsDir).map((filePath, index) =>
    readJson(filePath, assertPlanReviewSubmission, `submission[${index}]`),
  );
}

function readEventFiles(paths: PlanReviewSessionPaths): PlanReviewEvent[] {
  return listJsonFiles(paths.eventsDir).map((filePath, index) =>
    readJson(filePath, assertPlanReviewEvent, `event[${index}]`),
  );
}

export function loadSession(
  sessionDir: string,
  options: ReviewStateOptions = {},
): LoadedPlanReviewSession {
  const resolved = resolveSessionDir(sessionDir, options);
  const sessionId = path.basename(resolved);
  const paths = getReviewSessionPaths(sessionId, { reviewRoot: path.dirname(resolved) });
  const session = readJson(paths.sessionFile, assertPlanReviewSession, "session");
  const document = readJson(paths.documentFile, assertPlanReviewDocument, "document");
  const draftState = fs.existsSync(paths.draftStateFile)
    ? readJson(paths.draftStateFile, assertDraftState, "draftState")
    : createEmptyDraftState(session.id);
  return {
    sessionDir: resolved,
    paths,
    session,
    document,
    draftState,
    threads: readThreadFiles(paths),
    submissions: readSubmissionFiles(paths),
    events: readEventFiles(paths),
  };
}

export function listSessionPayload(
  sessionDir: string,
  options: ReviewStateOptions = {},
): SessionSummaryPayload {
  const loaded = loadSession(sessionDir, options);
  const latestSubmission = loaded.submissions.find(
    (submission) => submission.id === loaded.session.latestSubmissionId,
  ) ?? null;
  return {
    session: loaded.session,
    document: loaded.document,
    draftState: loaded.draftState,
    threadCount: loaded.threads.length,
    submissionCount: loaded.submissions.length,
    latestSubmission,
  };
}

function inferTitle(planFilePath: string, markdown: string): string {
  const parsed = parsePlanAnchors(markdown);
  if (parsed.title) return parsed.title;
  return path.basename(planFilePath, path.extname(planFilePath));
}

export function createInitialSession(
  input: CreateInitialSessionInput,
): CreateInitialSessionResult {
  const projectRoot = input.projectRoot ?? findProjectRoot();
  const requestedSessionDir = input.sessionDir
    ? resolveSessionDir(input.sessionDir, { projectRoot, reviewRoot: input.reviewRoot })
    : path.join(
        resolveReviewRoot({ projectRoot, reviewRoot: input.reviewRoot }),
        input.sessionId ?? createPlanReviewId("session"),
      );
  const sessionId = path.basename(requestedSessionDir);
  const paths = getReviewSessionPaths(sessionId, {
    reviewRoot: path.dirname(requestedSessionDir),
  });

  if (fs.existsSync(paths.sessionFile)) {
    throw new Error(`Plan review session already exists: ${paths.sessionFile}`);
  }

  const absolutePlanPath = path.resolve(projectRoot, input.planFilePath);
  if (!fs.existsSync(absolutePlanPath)) {
    throw new Error(`Plan file not found: ${absolutePlanPath}`);
  }

  const markdown = fs.readFileSync(absolutePlanPath, "utf-8");
  const parsed = parsePlanAnchors(markdown);
  const title = input.title?.trim() || inferTitle(absolutePlanPath, markdown);
  const createdAt = nowIso();

  ensureSessionDirs(paths);

  const snapshotId = createPlanReviewId("snapshot");
  const snapshot = createPlanReviewSnapshot({
    sessionId,
    planFilePath: absolutePlanPath,
    source: "initial",
    storagePath: snapshotStoragePath(snapshotId),
    sha256: sha256(markdown),
    byteLength: Buffer.byteLength(markdown, "utf-8"),
    lineCount: countLines(markdown),
    createdAt,
  });

  const snapshotPath = resolveSnapshotPath(paths, snapshot.id);
  writeTextAtomic(snapshotPath, markdown);

  const document = createPlanReviewDocument({
    sessionId,
    planFilePath: absolutePlanPath,
    title,
    currentSnapshotId: snapshot.id,
    anchors: parsed.anchors,
    snapshots: [snapshot],
    lineCount: parsed.lineCount,
    createdAt,
    updatedAt: createdAt,
  });

  const session = createPlanReviewSession({
    id: sessionId,
    planFilePath: absolutePlanPath,
    targetAgent: input.targetAgent,
    bridgeAgent: input.bridgeAgent,
    title,
    latestSnapshotId: snapshot.id,
    status: input.status ?? "open",
    createdAt,
    updatedAt: createdAt,
  });

  writeJsonAtomic(paths.documentFile, document);
  writeJsonAtomic(paths.sessionFile, session);
  writeJsonAtomic(paths.draftStateFile, createEmptyDraftState(session.id, createdAt));

  const openEvent = createPlanReviewEvent({
    sessionId: session.id,
    type: "review.session.open",
    summary: `Plan review opened for ${path.basename(absolutePlanPath)}`,
    actor: input.actor ?? session.bridgeAgent,
    payload: {
      snapshotId: snapshot.id,
      planFilePath: absolutePlanPath,
      targetAgent: session.targetAgent,
    },
    createdAt,
  });

  const eventPath = appendReviewEvent(paths.sessionDir, openEvent, {
    reviewRoot: paths.reviewRoot,
  });

  return {
    sessionDir: paths.sessionDir,
    sessionPath: paths.sessionFile,
    documentPath: paths.documentFile,
    snapshotPath,
    eventPath,
    session,
    document,
  };
}

function threadFilePath(paths: PlanReviewSessionPaths, threadId: string): string {
  return path.join(paths.threadsDir, `${threadId}.json`);
}

function submissionFilePath(paths: PlanReviewSessionPaths, submissionId: string): string {
  return path.join(paths.submissionsDir, `${submissionId}.json`);
}

function writeThread(paths: PlanReviewSessionPaths, thread: PlanReviewThread): string {
  const target = threadFilePath(paths, thread.id);
  writeJsonAtomic(target, thread);
  return target;
}

function readExistingThreadIfAny(
  paths: PlanReviewSessionPaths,
  threadId: string | null | undefined,
): PlanReviewThread | null {
  if (!threadId) return null;
  const target = threadFilePath(paths, threadId);
  if (!fs.existsSync(target)) return null;
  return readJson(target, assertPlanReviewThread, `thread:${threadId}`);
}

export function publishReround(
  input: PublishReroundInput,
): PublishReroundResult {
  const projectRoot = input.projectRoot ?? findProjectRoot();
  const loaded = loadSession(input.sessionDir, input);
  const createdAt = nowIso();
  const planFilePath = path.resolve(projectRoot, input.planFilePath ?? loaded.session.planFilePath);
  if (!fs.existsSync(planFilePath)) {
    throw new Error(`Plan file not found: ${planFilePath}`);
  }

  const markdown = fs.readFileSync(planFilePath, "utf-8");
  const sha = sha256(markdown);
  const currentSnapshot = loaded.document.snapshots.find(
    (snapshot) => snapshot.id === loaded.document.currentSnapshotId,
  );
  if (currentSnapshot && currentSnapshot.sha256 === sha) {
    throw new Error("Plan file is unchanged from the current snapshot");
  }

  const parsed = parsePlanAnchors(markdown);
  const snapshotId = createPlanReviewId("snapshot");
  const snapshot = createPlanReviewSnapshot({
    sessionId: loaded.session.id,
    planFilePath,
    source: "reround",
    storagePath: snapshotStoragePath(snapshotId),
    sha256: sha,
    byteLength: Buffer.byteLength(markdown, "utf-8"),
    lineCount: countLines(markdown),
    createdAt,
  });
  const snapshotPath = resolveSnapshotPath(loaded.paths, snapshot.id);
  writeTextAtomic(snapshotPath, markdown);

  const diff = buildPlanDiff(loaded.document.anchors, parsed.anchors);
  const updatedThreads = reconcileThreadsForReround(loaded.threads, parsed.anchors).map(
    (update) => {
      const currentThread = loaded.threads.find((thread) => thread.id === update.threadId);
      if (!currentThread) {
        throw new Error(`Thread not found during reround: ${update.threadId}`);
      }
      const nextThread: PlanReviewThread = {
        ...currentThread,
        anchor: update.anchor,
        latestSnapshotId: snapshot.id,
        stale: update.stale,
        updatedAt: createdAt,
      };
      writeThread(loaded.paths, nextThread);
      return nextThread;
    },
  );

  const updatedDocument: PlanReviewDocument = {
    ...loaded.document,
    planFilePath,
    currentSnapshotId: snapshot.id,
    anchorCount: parsed.anchors.length,
    lineCount: parsed.lineCount,
    anchors: parsed.anchors,
    snapshots: [...loaded.document.snapshots, snapshot],
    updatedAt: createdAt,
  };
  writeJsonAtomic(loaded.paths.documentFile, updatedDocument);

  const updatedSession: PlanReviewSession = {
    ...loaded.session,
    planFilePath,
    latestSnapshotId: snapshot.id,
    status: input.status ?? "open",
    updatedAt: createdAt,
  };
  writeJsonAtomic(loaded.paths.sessionFile, updatedSession);

  const summary =
    input.summary?.trim() ||
    `Reround ready with ${diff.deltaAnchorIds.length} changed block${diff.deltaAnchorIds.length === 1 ? "" : "s"}`;
  const event = createPlanReviewEvent({
    sessionId: loaded.session.id,
    type: "review.reround.ready",
    summary,
    actor: input.actor,
    payload: {
      parentSnapshotId: loaded.document.currentSnapshotId,
      snapshotId: snapshot.id,
      summary,
    },
    createdAt,
  });
  const eventPath = appendReviewEvent(loaded.paths.sessionDir, event, {
    reviewRoot: loaded.paths.reviewRoot,
  });

  return {
    session: updatedSession,
    document: updatedDocument,
    snapshotPath,
    diff,
    updatedThreads,
    event,
    eventPath,
  };
}

export function persistSubmission(
  input: PersistSubmissionInput,
  options: ReviewStateOptions = {},
): PersistSubmissionResult {
  const loaded = loadSession(input.sessionDir, options);
  const createdAt = nowIso();
  const createdThreads: PlanReviewThread[] = [];
  const feedback = input.feedback.map((draft) => {
    const existingThread = readExistingThreadIfAny(loaded.paths, draft.threadId);
    if (existingThread) {
      return createPlanReviewFeedbackItem({
        threadId: existingThread.id,
        anchor: draft.anchor,
        comment: draft.comment,
        suggestion: draft.suggestion,
        createdAt,
      });
    }

    const thread = createPlanReviewThread({
      sessionId: loaded.session.id,
      createdInSnapshotId: loaded.document.currentSnapshotId,
      latestSnapshotId: loaded.document.currentSnapshotId,
      anchor: draft.anchor,
      comment: draft.comment,
      suggestion: draft.suggestion,
      status: input.outcome === "approve" ? "accepted" : "open",
      createdAt,
      updatedAt: createdAt,
    });
    createdThreads.push(thread);
    writeThread(loaded.paths, thread);

    return createPlanReviewFeedbackItem({
      threadId: thread.id,
      anchor: draft.anchor,
      comment: draft.comment,
      suggestion: draft.suggestion,
      createdAt,
    });
  });

  const summary =
    input.summary?.trim() ||
    `${input.outcome === "approve" ? "Approved" : "Changes requested"} with ${feedback.length} feedback item${feedback.length === 1 ? "" : "s"}`;

  const submission = createPlanReviewSubmission({
    sessionId: loaded.session.id,
    snapshotId: loaded.document.currentSnapshotId,
    outcome: input.outcome,
    summary,
    feedback,
    actor: input.actor,
    targetAgent: input.targetAgent,
    createdAt,
  });

  const submissionPath = submissionFilePath(loaded.paths, submission.id);
  writeJsonAtomic(submissionPath, submission);

  const updatedSession: PlanReviewSession = {
    ...loaded.session,
    latestSubmissionId: submission.id,
    status: "ready",
    updatedAt: createdAt,
  };
  writeJsonAtomic(loaded.paths.sessionFile, updatedSession);
  writeJsonAtomic(loaded.paths.draftStateFile, createEmptyDraftState(loaded.session.id, createdAt));

  const submissionEvent = createPlanReviewEvent({
    sessionId: loaded.session.id,
    submissionId: submission.id,
    type: "review.submission.create",
    summary,
    actor: input.actor,
    payload: {
      submissionId: submission.id,
      snapshotId: submission.snapshotId,
      outcome: submission.outcome,
      feedbackCount: submission.feedbackCount,
      targetAgent: submission.targetAgent,
    },
    createdAt,
  });

  const resultEvent = createPlanReviewEvent({
    sessionId: loaded.session.id,
    submissionId: submission.id,
    type: "review.result.ready",
    summary,
    actor: input.actor,
    payload: {
      submissionId: submission.id,
      outcome: submission.outcome,
      feedbackCount: submission.feedbackCount,
      summary: submission.summary,
      targetAgent: submission.targetAgent,
    },
    createdAt,
  });

  const submissionEventPath = appendReviewEvent(loaded.paths.sessionDir, submissionEvent, {
    reviewRoot: loaded.paths.reviewRoot,
  });
  const resultEventPath = appendReviewEvent(loaded.paths.sessionDir, resultEvent, {
    reviewRoot: loaded.paths.reviewRoot,
  });

  return {
    session: updatedSession,
    submission,
    createdThreads,
    submissionPath,
    submissionEventPath,
    resultEventPath,
  };
}
