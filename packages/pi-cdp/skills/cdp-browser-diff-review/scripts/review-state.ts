import * as fs from "node:fs";
import * as path from "node:path";

import {
  assertReviewEvent,
  assertReviewRound,
  assertReviewSession,
  assertReviewSnapshotManifest,
  assertReviewThread,
  createReviewEvent,
  createReviewSession,
  createReviewThread,
  nowIso,
  type ReviewAnchorSide,
  type ReviewEvent,
  type ReviewEventType,
  type ReviewFileChange,
  type ReviewRound,
  type ReviewSession,
  type ReviewSessionStatus,
  type ReviewSnapshotManifest,
  type ReviewThread,
  type ReviewThreadStatus,
} from "./session-types";

const DEFAULT_REVIEW_ROOT = path.join("workspace", "scratch", "diff-reviews");

export interface ReviewStateOptions {
  projectRoot?: string;
  reviewRoot?: string;
}

export interface ReviewSessionPaths {
  reviewRoot: string;
  sessionDir: string;
  sessionFile: string;
  roundsDir: string;
  threadsDir: string;
  eventsDir: string;
  snapshotsDir: string;
  roundDiffsDir: string;
}

export interface ReviewSnapshotPaths {
  snapshotDir: string;
  manifestFile: string;
  filesDir: string;
}

export interface ListReviewEventsOptions extends ReviewStateOptions {
  type?: ReviewEventType | ReviewEventType[];
  roundId?: string;
  threadId?: string;
  limit?: number;
}

export interface ReviewStateBundle {
  session: ReviewSession;
  rounds: ReviewRound[];
  threads: ReviewThread[];
  events: ReviewEvent[];
}

export interface LoadedReviewSession extends ReviewStateBundle {
  sessionDir: string;
  paths: ReviewSessionPaths;
  snapshots: ReviewSnapshotManifest[];
  reviewedPaths: string[];
}

export type ReviewRoundViewMode = "delta" | "cumulative" | "initial";

export interface ReviewFilePayload {
  path: string;
  displayPath: string;
  status: ReviewFileChange["status"];
  previousPath?: string;
  reviewed: boolean;
}

export interface SessionPayload {
  session: ReviewSession;
  latestRound: ReviewRound | null;
  rounds: ReviewRound[];
  files: {
    delta: ReviewFilePayload[];
    cumulative: ReviewFilePayload[];
    initial: ReviewFilePayload[];
  };
  threads: ReviewThread[];
  reviewedPaths: string[];
  unreadRoundReady: boolean;
}

export interface ReviewDraftComment {
  kind: "inline" | "file";
  path: string;
  side?: ReviewAnchorSide;
  startLine?: number | null;
  endLine?: number | null;
  body: string;
}

export interface CreateInitialSessionInput extends ReviewStateOptions {
  sessionId?: string;
  sessionDir?: string;
  repoRoot: string;
  targetAgent: string;
  bridgeAgent: string;
  title: string;
  initialRound: ReviewRound;
  baselineSnapshotId?: string;
  status?: ReviewSessionStatus;
  actor?: string;
}

export interface CreateInitialSessionResult {
  sessionDir: string;
  sessionPath: string;
  initialRoundPath: string;
  sessionOpenEventPath: string;
  roundReadyEventPath: string;
  session: ReviewSession;
  initialRound: ReviewRound;
}

export interface PersistBatchSubmissionInput {
  sessionDir: string;
  drafts: ReviewDraftComment[];
  actor: string;
  targetAgent: string;
  roundId?: string | null;
  summary?: string;
}

export interface PersistBatchSubmissionResult {
  session: ReviewSession;
  createdThreads: ReviewThread[];
  batchEvent: ReviewEvent<"review.batch.submit">;
  batchEventPath: string;
  threadReplyEventPaths: string[];
}

export interface PersistThreadReplyInput {
  sessionDir: string;
  threadId: string;
  actor: string;
  body: string;
  status?: ReviewThreadStatus;
  roundId?: string | null;
  summary?: string;
}

export interface PersistThreadReplyResult {
  thread: ReviewThread;
  event: ReviewEvent<"review.thread.reply">;
  eventPath: string;
}

export interface PersistThreadStatusInput {
  sessionDir: string;
  threadId: string;
  status: ReviewThreadStatus;
  actor: string;
  roundId?: string | null;
  note?: string;
}

export interface PersistThreadStatusResult {
  thread: ReviewThread;
  event:
    | ReviewEvent<"review.thread.accept">
    | ReviewEvent<"review.thread.reopen">
    | ReviewEvent<"review.thread.addressed">;
  eventPath: string;
}

export interface PublishReroundInput {
  sessionDir: string;
  round: ReviewRound;
  actor: string;
  summary?: string;
  status?: ReviewSessionStatus;
}

export interface PublishReroundResult {
  round: ReviewRound;
  roundPath: string;
  session: ReviewSession;
  event: ReviewEvent<"review.round.ready">;
  eventPath: string;
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

function looksLikePathInput(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    value.includes("/") ||
    value.includes("\\")
  );
}

function normalizeSessionContext(
  sessionDir: string,
  options: ReviewStateOptions = {}
): { sessionId: string; options: ReviewStateOptions; paths: ReviewSessionPaths } {
  const resolved = resolveSessionDir(sessionDir, options);
  const sessionId = path.basename(resolved);
  if (!sessionId) {
    throw new Error(`Unable to resolve session id from path: ${sessionDir}`);
  }

  const contextOptions: ReviewStateOptions = {
    reviewRoot: path.dirname(resolved),
  };

  const paths = getReviewSessionPaths(sessionId, contextOptions);
  return { sessionId, options: contextOptions, paths };
}

export function resolveSessionDir(
  sessionIdOrDir: string,
  options: ReviewStateOptions = {}
): string {
  const value = sessionIdOrDir.trim();
  if (!value) {
    throw new Error("session id or directory is required");
  }

  if (looksLikePathInput(value)) {
    return path.resolve(value);
  }

  return path.join(resolveReviewRoot(options), value);
}

export function getReviewSessionPaths(
  sessionId: string,
  options: ReviewStateOptions = {}
): ReviewSessionPaths {
  const reviewRoot = resolveReviewRoot(options);
  const sessionDir = path.join(reviewRoot, sessionId);
  return {
    reviewRoot,
    sessionDir,
    sessionFile: path.join(sessionDir, "session.json"),
    roundsDir: path.join(sessionDir, "rounds"),
    threadsDir: path.join(sessionDir, "threads"),
    eventsDir: path.join(sessionDir, "events"),
    snapshotsDir: path.join(sessionDir, "snapshots"),
    roundDiffsDir: path.join(sessionDir, "round-diffs"),
  };
}

export function ensureReviewSessionLayout(
  sessionId: string,
  options: ReviewStateOptions = {}
): ReviewSessionPaths {
  const paths = getReviewSessionPaths(sessionId, options);
  fs.mkdirSync(paths.sessionDir, { recursive: true });
  fs.mkdirSync(paths.roundsDir, { recursive: true });
  fs.mkdirSync(paths.threadsDir, { recursive: true });
  fs.mkdirSync(paths.eventsDir, { recursive: true });
  fs.mkdirSync(paths.snapshotsDir, { recursive: true });
  fs.mkdirSync(paths.roundDiffsDir, { recursive: true });
  return paths;
}

export function reviewSessionExists(
  sessionId: string,
  options: ReviewStateOptions = {}
): boolean {
  const paths = getReviewSessionPaths(sessionId, options);
  return fs.existsSync(paths.sessionFile);
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
}

function readJson(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function listJsonFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .filter((file) => file.endsWith(".json"))
    .sort();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizePathList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function readReviewedPathsFromSessionFile(sessionFile: string): string[] {
  if (!fs.existsSync(sessionFile)) return [];
  try {
    const payload = readJson(sessionFile);
    if (
      typeof payload === "object" &&
      payload !== null &&
      "reviewedPaths" in payload
    ) {
      return uniqueStrings(
        normalizePathList((payload as Record<string, unknown>).reviewedPaths)
      ).sort((a, b) => a.localeCompare(b));
    }
  } catch {
    // best effort for compatibility with non-schema fields
  }
  return [];
}

function readReviewedPathsFromLegacyEvents(eventsDir: string): string[] {
  const reviewed = new Set<string>();
  for (const file of listJsonFiles(eventsDir)) {
    const filePath = path.join(eventsDir, file);
    try {
      const payload = readJson(filePath);
      if (typeof payload !== "object" || payload === null) continue;
      const record = payload as Record<string, unknown>;
      if (record.type !== "review.file.reviewed") continue;
      if (typeof record.path !== "string") continue;
      if (record.reviewed === false) {
        reviewed.delete(record.path);
      } else {
        reviewed.add(record.path);
      }
    } catch {
      // ignore malformed files
    }
  }
  return [...reviewed].sort((a, b) => a.localeCompare(b));
}

function listReviewEventsLenient(
  sessionId: string,
  options: ReviewStateOptions = {}
): ReviewEvent[] {
  const paths = getReviewSessionPaths(sessionId, options);
  return listJsonFiles(paths.eventsDir)
    .map((file) => {
      try {
        return assertReviewEvent(
          readJson(path.join(paths.eventsDir, file)),
          `event:${file}`
        );
      } catch {
        return null;
      }
    })
    .filter((event): event is ReviewEvent => event !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function writeReviewSession(
  session: ReviewSession,
  options: ReviewStateOptions = {}
): string {
  assertReviewSession(session);
  const paths = ensureReviewSessionLayout(session.id, options);
  writeJsonAtomic(paths.sessionFile, session);
  return paths.sessionFile;
}

export function readReviewSession(
  sessionId: string,
  options: ReviewStateOptions = {}
): ReviewSession {
  const paths = getReviewSessionPaths(sessionId, options);
  if (!fs.existsSync(paths.sessionFile)) {
    throw new Error(`Review session not found: ${paths.sessionFile}`);
  }
  return assertReviewSession(readJson(paths.sessionFile), `session:${sessionId}`);
}

export function tryReadReviewSession(
  sessionId: string,
  options: ReviewStateOptions = {}
): ReviewSession | null {
  const paths = getReviewSessionPaths(sessionId, options);
  if (!fs.existsSync(paths.sessionFile)) return null;
  return assertReviewSession(readJson(paths.sessionFile), `session:${sessionId}`);
}

export function updateReviewSession(
  sessionId: string,
  updater: (current: ReviewSession) => ReviewSession,
  options: ReviewStateOptions = {}
): ReviewSession {
  const current = readReviewSession(sessionId, options);
  const updated = updater(current);
  const normalized: ReviewSession = {
    ...updated,
    updatedAt: nowIso(),
  };
  writeReviewSession(normalized, options);
  return normalized;
}

export function writeReviewRound(
  round: ReviewRound,
  options: ReviewStateOptions = {}
): string {
  assertReviewRound(round);
  const paths = ensureReviewSessionLayout(round.sessionId, options);
  const filePath = path.join(paths.roundsDir, `${round.id}.json`);
  writeJsonAtomic(filePath, round);
  return filePath;
}

export function readReviewRound(
  sessionId: string,
  roundId: string,
  options: ReviewStateOptions = {}
): ReviewRound {
  const paths = getReviewSessionPaths(sessionId, options);
  const filePath = path.join(paths.roundsDir, `${roundId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Review round not found: ${filePath}`);
  }
  return assertReviewRound(readJson(filePath), `round:${roundId}`);
}

export function listReviewRounds(
  sessionId: string,
  options: ReviewStateOptions = {}
): ReviewRound[] {
  const paths = getReviewSessionPaths(sessionId, options);
  return listJsonFiles(paths.roundsDir)
    .map((file) =>
      assertReviewRound(readJson(path.join(paths.roundsDir, file)), `round:${file}`)
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function writeReviewThread(
  thread: ReviewThread,
  options: ReviewStateOptions = {}
): string {
  assertReviewThread(thread);
  const paths = ensureReviewSessionLayout(thread.sessionId, options);
  const filePath = path.join(paths.threadsDir, `${thread.id}.json`);
  writeJsonAtomic(filePath, thread);
  return filePath;
}

export function readReviewThread(
  sessionId: string,
  threadId: string,
  options: ReviewStateOptions = {}
): ReviewThread {
  const paths = getReviewSessionPaths(sessionId, options);
  const filePath = path.join(paths.threadsDir, `${threadId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Review thread not found: ${filePath}`);
  }
  return assertReviewThread(readJson(filePath), `thread:${threadId}`);
}

export function listReviewThreads(
  sessionId: string,
  options: ReviewStateOptions = {}
): ReviewThread[] {
  const paths = getReviewSessionPaths(sessionId, options);
  return listJsonFiles(paths.threadsDir)
    .map((file) =>
      assertReviewThread(
        readJson(path.join(paths.threadsDir, file)),
        `thread:${file}`
      )
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function normalizeEventTypeFilter(
  value: ListReviewEventsOptions["type"]
): Set<ReviewEventType> | null {
  if (!value) return null;
  if (Array.isArray(value)) return new Set(value);
  return new Set([value]);
}

function eventFileName(event: ReviewEvent): string {
  const timestamp = event.createdAt.replace(/[:.]/g, "-");
  const type = event.type.replace(/\./g, "-");
  return `${timestamp}-${type}-${event.id}.json`;
}

export function appendReviewEvent(
  event: ReviewEvent,
  options: ReviewStateOptions = {}
): string {
  assertReviewEvent(event);
  const paths = ensureReviewSessionLayout(event.sessionId, options);
  const filePath = path.join(paths.eventsDir, eventFileName(event));
  writeJsonAtomic(filePath, event);
  return filePath;
}

export function listReviewEvents(
  sessionId: string,
  options: ListReviewEventsOptions = {}
): ReviewEvent[] {
  const paths = getReviewSessionPaths(sessionId, options);
  const byType = normalizeEventTypeFilter(options.type);

  const filtered = listJsonFiles(paths.eventsDir)
    .map((file) =>
      assertReviewEvent(readJson(path.join(paths.eventsDir, file)), `event:${file}`)
    )
    .filter((event) => {
      if (byType && !byType.has(event.type)) return false;
      if (options.roundId && event.roundId !== options.roundId) return false;
      if (options.threadId && event.threadId !== options.threadId) return false;
      return true;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (typeof options.limit === "number" && options.limit >= 0) {
    return filtered.slice(-options.limit);
  }

  return filtered;
}

export function getReviewSnapshotPaths(
  sessionId: string,
  snapshotId: string,
  options: ReviewStateOptions = {}
): ReviewSnapshotPaths {
  const sessionPaths = getReviewSessionPaths(sessionId, options);
  const snapshotDir = path.join(sessionPaths.snapshotsDir, snapshotId);
  return {
    snapshotDir,
    manifestFile: path.join(snapshotDir, "manifest.json"),
    filesDir: path.join(snapshotDir, "files"),
  };
}

export function ensureReviewSnapshotLayout(
  sessionId: string,
  snapshotId: string,
  options: ReviewStateOptions = {}
): ReviewSnapshotPaths {
  ensureReviewSessionLayout(sessionId, options);
  const paths = getReviewSnapshotPaths(sessionId, snapshotId, options);
  fs.mkdirSync(paths.snapshotDir, { recursive: true });
  fs.mkdirSync(paths.filesDir, { recursive: true });
  return paths;
}

export function writeReviewSnapshotManifest(
  manifest: ReviewSnapshotManifest,
  options: ReviewStateOptions = {}
): string {
  assertReviewSnapshotManifest(manifest);
  const paths = ensureReviewSnapshotLayout(manifest.sessionId, manifest.id, options);
  writeJsonAtomic(paths.manifestFile, manifest);
  return paths.manifestFile;
}

export function readReviewSnapshotManifest(
  sessionId: string,
  snapshotId: string,
  options: ReviewStateOptions = {}
): ReviewSnapshotManifest {
  const paths = getReviewSnapshotPaths(sessionId, snapshotId, options);
  if (!fs.existsSync(paths.manifestFile)) {
    throw new Error(`Review snapshot manifest not found: ${paths.manifestFile}`);
  }
  return assertReviewSnapshotManifest(
    readJson(paths.manifestFile),
    `snapshot:${snapshotId}`
  );
}

export function listReviewSnapshotManifests(
  sessionId: string,
  options: ReviewStateOptions = {}
): ReviewSnapshotManifest[] {
  const sessionPaths = getReviewSessionPaths(sessionId, options);
  if (!fs.existsSync(sessionPaths.snapshotsDir)) return [];

  const snapshots = fs
    .readdirSync(sessionPaths.snapshotsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((snapshotId) => readReviewSnapshotManifest(sessionId, snapshotId, options));

  return snapshots.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function resolveSnapshotStoragePath(
  filesRoot: string,
  relativePath: string
): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Snapshot path must be relative: ${relativePath}`);
  }

  const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/"));
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Snapshot path escapes root: ${relativePath}`);
  }

  return path.join(filesRoot, normalized);
}

export function writeSnapshotFile(
  filesRoot: string,
  relativePath: string,
  content: string | Buffer
): string {
  const fullPath = resolveSnapshotStoragePath(filesRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  return toPosixPath(path.relative(filesRoot, fullPath));
}

export function readSnapshotFile(
  filesRoot: string,
  relativePath: string
): Buffer {
  const fullPath = resolveSnapshotStoragePath(filesRoot, relativePath);
  return fs.readFileSync(fullPath);
}

export function loadReviewStateBundle(
  sessionId: string,
  options: ReviewStateOptions = {}
): ReviewStateBundle {
  return {
    session: readReviewSession(sessionId, options),
    rounds: listReviewRounds(sessionId, options),
    threads: listReviewThreads(sessionId, options),
    events: listReviewEvents(sessionId, options),
  };
}

function requireRoundId(roundId: string | null, context: string): string {
  if (!roundId) {
    throw new Error(`${context}: round id is required`);
  }
  return roundId;
}

function buildFilePayload(
  change: ReviewFileChange,
  reviewedPaths: Set<string>
): ReviewFilePayload {
  return {
    path: change.path,
    displayPath:
      change.previousPath && change.previousPath !== change.path
        ? `${change.previousPath} → ${change.path}`
        : change.path,
    status: change.status,
    previousPath: change.previousPath,
    reviewed: reviewedPaths.has(change.path),
  };
}

function listRoundFilePayload(
  round: ReviewRound | null,
  reviewedPaths: Set<string>
): ReviewFilePayload[] {
  if (!round) return [];

  const changeMap = new Map<string, ReviewFileChange>();
  for (const change of round.fileChanges) {
    changeMap.set(change.path, change);
  }

  for (const filePath of round.changedFiles) {
    if (!changeMap.has(filePath)) {
      changeMap.set(filePath, {
        path: filePath,
        status: "unknown",
      });
    }
  }

  return [...changeMap.values()]
    .map((change) => buildFilePayload(change, reviewedPaths))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function sortRounds(rounds: ReviewRound[]): ReviewRound[] {
  return [...rounds].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function pickLatestRound(
  rounds: ReviewRound[],
  latestRoundId: string | null
): ReviewRound | null {
  if (rounds.length === 0) return null;
  if (latestRoundId) {
    const match = rounds.find((round) => round.id === latestRoundId);
    if (match) return match;
  }
  return rounds[rounds.length - 1] ?? null;
}

function pickInitialRound(
  rounds: ReviewRound[],
  fallback: ReviewRound | null
): ReviewRound | null {
  const initial = rounds.find((round) => round.kind === "initial");
  if (initial) return initial;
  return rounds[0] ?? fallback;
}

export function loadSession(sessionDir: string): LoadedReviewSession {
  const context = normalizeSessionContext(sessionDir);
  const session = readReviewSession(context.sessionId, context.options);
  const rounds = listReviewRounds(context.sessionId, context.options);
  const threads = listReviewThreads(context.sessionId, context.options);
  const events = listReviewEventsLenient(context.sessionId, context.options);
  const snapshots = listReviewSnapshotManifests(context.sessionId, context.options);
  const reviewedPaths = uniqueStrings([
    ...readReviewedPathsFromSessionFile(context.paths.sessionFile),
    ...readReviewedPathsFromLegacyEvents(context.paths.eventsDir),
  ]).sort((a, b) => a.localeCompare(b));

  return {
    session,
    rounds,
    threads,
    events,
    sessionDir: context.paths.sessionDir,
    paths: context.paths,
    snapshots,
    reviewedPaths,
  };
}

export function createInitialSession(
  input: CreateInitialSessionInput
): CreateInitialSessionResult {
  const sessionDir = resolveSessionDir(
    input.sessionDir ?? input.sessionId ?? input.initialRound.sessionId,
    input
  );
  const context = normalizeSessionContext(sessionDir, input);

  const initialRound = assertReviewRound(
    {
      ...input.initialRound,
      sessionId: context.sessionId,
      kind: "initial",
      parentRoundId: null,
    },
    "initialRound"
  );

  const session = createReviewSession({
    id: context.sessionId,
    repoRoot: input.repoRoot,
    targetAgent: input.targetAgent,
    bridgeAgent: input.bridgeAgent,
    title: input.title,
    status: input.status ?? "ready",
    baselineSnapshotId: input.baselineSnapshotId ?? initialRound.baseSnapshotId,
    latestRoundId: initialRound.id,
  });

  const sessionPath = writeReviewSession(session, context.options);
  const initialRoundPath = writeReviewRound(initialRound, context.options);

  const sessionOpenEventPath = appendReviewEvent(
    createReviewEvent({
      sessionId: session.id,
      roundId: initialRound.id,
      type: "review.session.open",
      summary: `Opened diff review session '${session.title}'.`,
      actor: input.actor ?? session.bridgeAgent,
      payload: {
        initialRoundId: initialRound.id,
        sourceScope: initialRound.sourceScope,
      },
    }),
    context.options
  );

  const roundReadyEventPath = appendReviewEvent(
    createReviewEvent({
      sessionId: session.id,
      roundId: initialRound.id,
      type: "review.round.ready",
      summary: initialRound.summary,
      actor: input.actor ?? session.targetAgent,
      payload: {
        roundId: initialRound.id,
        parentRoundId: null,
        changedFiles: initialRound.changedFiles,
        affectedThreadIds: initialRound.affectedThreadIds,
        summary: initialRound.summary,
      },
    }),
    context.options
  );

  return {
    sessionDir: context.paths.sessionDir,
    sessionPath,
    initialRoundPath,
    sessionOpenEventPath,
    roundReadyEventPath,
    session,
    initialRound,
  };
}

export function persistBatchSubmission(
  input: PersistBatchSubmissionInput
): PersistBatchSubmissionResult {
  const context = normalizeSessionContext(input.sessionDir);
  const session = readReviewSession(context.sessionId, context.options);
  const roundId = requireRoundId(
    input.roundId ?? session.latestRoundId,
    "persistBatchSubmission"
  );

  const now = nowIso();
  const createdThreads: ReviewThread[] = [];
  const threadReplyEventPaths: string[] = [];

  for (const draft of input.drafts) {
    const normalizedBody = draft.body.trim();
    if (!normalizedBody) continue;

    const thread = createReviewThread({
      sessionId: session.id,
      createdInRoundId: roundId,
      latestRoundId: roundId,
      path: draft.path,
      anchor: {
        side: draft.side ?? (draft.kind === "file" ? "file" : "modified"),
        startLine: draft.startLine ?? null,
        endLine: draft.endLine ?? null,
      },
      status: "open",
      stale: false,
      createdAt: now,
      updatedAt: now,
    });

    writeReviewThread(thread, context.options);
    createdThreads.push(thread);

    const replyPath = appendReviewEvent(
      createReviewEvent({
        sessionId: session.id,
        roundId,
        threadId: thread.id,
        type: "review.thread.reply",
        summary: `Reviewer comment on ${thread.path}`,
        actor: input.actor,
        payload: {
          threadId: thread.id,
          body: normalizedBody,
        },
      }),
      context.options
    );
    threadReplyEventPaths.push(replyPath);
  }

  const batchEvent = createReviewEvent({
    sessionId: session.id,
    roundId,
    type: "review.batch.submit",
    summary:
      input.summary ??
      `Submitted ${createdThreads.length} draft comment(s) for review.`,
    actor: input.actor,
    payload: {
      roundId,
      threadIds: createdThreads.map((thread) => thread.id),
      draftCount: createdThreads.length,
      targetAgent: input.targetAgent,
    },
  });

  const batchEventPath = appendReviewEvent(batchEvent, context.options);

  const updatedSession = updateReviewSession(
    session.id,
    (current) => ({
      ...current,
      status: "waiting",
    }),
    context.options
  );

  return {
    session: updatedSession,
    createdThreads,
    batchEvent,
    batchEventPath,
    threadReplyEventPaths,
  };
}

export function persistThreadReply(
  input: PersistThreadReplyInput
): PersistThreadReplyResult {
  const context = normalizeSessionContext(input.sessionDir);
  const session = readReviewSession(context.sessionId, context.options);
  const thread = readReviewThread(session.id, input.threadId, context.options);
  const roundId = input.roundId ?? session.latestRoundId ?? thread.latestRoundId;
  const body = input.body.trim();

  if (!body) {
    throw new Error("persistThreadReply requires a non-empty body");
  }

  const updatedThread: ReviewThread = {
    ...thread,
    latestRoundId: roundId ?? thread.latestRoundId,
    status: input.status ?? thread.status,
    updatedAt: nowIso(),
  };

  writeReviewThread(updatedThread, context.options);

  const event = createReviewEvent({
    sessionId: session.id,
    roundId,
    threadId: updatedThread.id,
    type: "review.thread.reply",
    summary: input.summary ?? `Reply posted on ${updatedThread.path}`,
    actor: input.actor,
    payload: {
      threadId: updatedThread.id,
      body,
      status: input.status,
    },
  });

  const eventPath = appendReviewEvent(event, context.options);
  return {
    thread: updatedThread,
    event,
    eventPath,
  };
}

export function persistThreadStatus(
  input: PersistThreadStatusInput
): PersistThreadStatusResult {
  const context = normalizeSessionContext(input.sessionDir);
  const session = readReviewSession(context.sessionId, context.options);
  const thread = readReviewThread(session.id, input.threadId, context.options);
  const roundId = input.roundId ?? session.latestRoundId ?? thread.latestRoundId;

  const updatedThread: ReviewThread = {
    ...thread,
    status: input.status,
    latestRoundId: roundId ?? thread.latestRoundId,
    updatedAt: nowIso(),
  };
  writeReviewThread(updatedThread, context.options);

  if (input.status === "accepted") {
    const event = createReviewEvent({
      sessionId: session.id,
      roundId,
      threadId: updatedThread.id,
      type: "review.thread.accept",
      summary: `Thread accepted for ${updatedThread.path}`,
      actor: input.actor,
      payload: {
        threadId: updatedThread.id,
        note: input.note,
      },
    });

    return {
      thread: updatedThread,
      event,
      eventPath: appendReviewEvent(event, context.options),
    };
  }

  if (input.status === "addressed") {
    const event = createReviewEvent({
      sessionId: session.id,
      roundId,
      threadId: updatedThread.id,
      type: "review.thread.addressed",
      summary: `Thread marked addressed for ${updatedThread.path}`,
      actor: input.actor,
      payload: {
        threadId: updatedThread.id,
        roundId: roundId ?? undefined,
        note: input.note,
      },
    });

    return {
      thread: updatedThread,
      event,
      eventPath: appendReviewEvent(event, context.options),
    };
  }

  const event = createReviewEvent({
    sessionId: session.id,
    roundId,
    threadId: updatedThread.id,
    type: "review.thread.reopen",
    summary: `Thread reopened for ${updatedThread.path}`,
    actor: input.actor,
    payload: {
      threadId: updatedThread.id,
      note: input.note,
    },
  });

  return {
    thread: updatedThread,
    event,
    eventPath: appendReviewEvent(event, context.options),
  };
}

export function publishReround(
  input: PublishReroundInput
): PublishReroundResult {
  const context = normalizeSessionContext(input.sessionDir);
  const session = readReviewSession(context.sessionId, context.options);

  const round = assertReviewRound(
    {
      ...input.round,
      sessionId: session.id,
      kind: "reround",
      parentRoundId: input.round.parentRoundId ?? session.latestRoundId,
    },
    "publishReround.round"
  );

  const roundPath = writeReviewRound(round, context.options);

  for (const threadId of round.affectedThreadIds) {
    const threadPath = path.join(context.paths.threadsDir, `${threadId}.json`);
    if (!fs.existsSync(threadPath)) continue;
    const thread = readReviewThread(session.id, threadId, context.options);
    writeReviewThread(
      {
        ...thread,
        latestRoundId: round.id,
        updatedAt: nowIso(),
      },
      context.options
    );
  }

  const updatedSession = updateReviewSession(
    session.id,
    (current) => ({
      ...current,
      latestRoundId: round.id,
      status: input.status ?? "ready",
    }),
    context.options
  );

  const event = createReviewEvent({
    sessionId: session.id,
    roundId: round.id,
    type: "review.round.ready",
    summary: input.summary ?? round.summary,
    actor: input.actor,
    payload: {
      roundId: round.id,
      parentRoundId: round.parentRoundId,
      changedFiles: round.changedFiles,
      affectedThreadIds: round.affectedThreadIds,
      summary: input.summary ?? round.summary,
    },
  });

  const eventPath = appendReviewEvent(event, context.options);

  return {
    round,
    roundPath,
    session: updatedSession,
    event,
    eventPath,
  };
}

export function listSessionPayload(
  sessionDir: string,
  unreadRoundReady = false
): SessionPayload {
  const loaded = loadSession(sessionDir);
  const rounds = sortRounds(loaded.rounds);
  const latestRound = pickLatestRound(rounds, loaded.session.latestRoundId);
  const initialRound = pickInitialRound(rounds, latestRound);
  const reviewedPaths = new Set<string>(loaded.reviewedPaths);

  const cumulativeMap = new Map<string, ReviewFilePayload>();
  for (const round of rounds) {
    for (const file of listRoundFilePayload(round, reviewedPaths)) {
      cumulativeMap.set(file.path, file);
    }
  }

  return {
    session: loaded.session,
    latestRound,
    rounds,
    files: {
      delta: listRoundFilePayload(latestRound, reviewedPaths),
      cumulative: [...cumulativeMap.values()].sort((a, b) =>
        a.path.localeCompare(b.path)
      ),
      initial: listRoundFilePayload(initialRound, reviewedPaths),
    },
    threads: [...loaded.threads].sort((a, b) => a.path.localeCompare(b.path)),
    reviewedPaths: [...reviewedPaths].sort((a, b) => a.localeCompare(b)),
    unreadRoundReady,
  };
}
