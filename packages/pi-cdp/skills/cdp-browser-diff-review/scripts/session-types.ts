import { randomUUID } from "node:crypto";

export const DIFF_REVIEW_SCHEMA_VERSION = 1 as const;
export const DIFF_REVIEW_KIND = "diff-review" as const;

export type ISODateString = string;

export interface DiffReviewRecord {
  schemaVersion: typeof DIFF_REVIEW_SCHEMA_VERSION;
  reviewKind: typeof DIFF_REVIEW_KIND;
}

export const REVIEW_SESSION_STATUSES = [
  "open",
  "waiting",
  "ready",
  "closed",
] as const;

export type ReviewSessionStatus = (typeof REVIEW_SESSION_STATUSES)[number];

export const REVIEW_ROUND_KINDS = ["initial", "reround"] as const;

export type ReviewRoundKind = (typeof REVIEW_ROUND_KINDS)[number];

export const REVIEW_SOURCE_SCOPE_KINDS = [
  "worktree",
  "staged",
  "last-commit",
  "commit-range",
  "custom",
] as const;

export type ReviewSourceScopeKind = (typeof REVIEW_SOURCE_SCOPE_KINDS)[number];

export interface ReviewSourceScope {
  kind: ReviewSourceScopeKind;
  paths?: string[];
  /** Used by commit-range/custom scopes */
  baseRef?: string;
  /** Used by commit-range/custom scopes */
  headRef?: string;
  /** Human label for custom scopes */
  label?: string;
}

export const REVIEW_FILE_CHANGE_STATUSES = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type-changed",
  "unknown",
] as const;

export type ReviewFileChangeStatus =
  (typeof REVIEW_FILE_CHANGE_STATUSES)[number];

export interface ReviewFileChange {
  path: string;
  status: ReviewFileChangeStatus;
  previousPath?: string;
}

export interface ReviewSession extends DiffReviewRecord {
  id: string;
  repoRoot: string;
  targetAgent: string;
  bridgeAgent: string;
  title: string;
  status: ReviewSessionStatus;
  baselineSnapshotId: string;
  latestRoundId: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ReviewRound extends DiffReviewRecord {
  id: string;
  sessionId: string;
  parentRoundId: string | null;
  kind: ReviewRoundKind;
  sourceScope: ReviewSourceScope;
  baseSnapshotId: string;
  headSnapshotId: string;
  changedFiles: string[];
  fileChanges: ReviewFileChange[];
  affectedThreadIds: string[];
  summary: string;
  requestedBy: string;
  createdAt: ISODateString;
}

export const REVIEW_THREAD_STATUSES = [
  "open",
  "addressed",
  "accepted",
] as const;

export type ReviewThreadStatus = (typeof REVIEW_THREAD_STATUSES)[number];

export const REVIEW_ANCHOR_SIDES = ["original", "modified", "file"] as const;

export type ReviewAnchorSide = (typeof REVIEW_ANCHOR_SIDES)[number];

export interface ReviewThreadAnchor {
  side: ReviewAnchorSide;
  startLine: number | null;
  endLine: number | null;
  contextBefore?: string[];
  contextAfter?: string[];
}

export interface ReviewThread extends DiffReviewRecord {
  id: string;
  sessionId: string;
  createdInRoundId: string;
  latestRoundId: string;
  path: string;
  anchor: ReviewThreadAnchor;
  status: ReviewThreadStatus;
  stale: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export const REVIEW_SNAPSHOT_TARGET_KINDS = [
  "commit",
  "index",
  "worktree",
] as const;

export type ReviewSnapshotTargetKind =
  (typeof REVIEW_SNAPSHOT_TARGET_KINDS)[number];

export interface ReviewSnapshotTarget {
  kind: ReviewSnapshotTargetKind;
  /** Requested git ref (if applicable) */
  ref: string | null;
  /** Resolved immutable ref (commit SHA when available) */
  resolvedRef: string | null;
}

export type ReviewSnapshotSide = "base" | "head";

export interface ReviewSnapshotFile {
  /** Path captured in this snapshot side */
  path: string;
  /** Canonical round path (usually head path) */
  canonicalPath: string;
  status: ReviewFileChangeStatus;
  previousPath?: string;
  present: boolean;
  byteLength: number;
  sha256: string | null;
  /** Relative path under snapshots/<snapshot-id>/files/ */
  storagePath: string | null;
}

export interface ReviewSnapshotManifest extends DiffReviewRecord {
  id: string;
  sessionId: string;
  side: ReviewSnapshotSide;
  repoRoot: string;
  sourceScope: ReviewSourceScope;
  target: ReviewSnapshotTarget;
  files: ReviewSnapshotFile[];
  createdAt: ISODateString;
}

export const REVIEW_EVENT_TYPES = [
  "review.session.open",
  "review.batch.submit",
  "review.thread.reply",
  "review.thread.accept",
  "review.thread.reopen",
  "review.thread.addressed",
  "review.round.request",
  "review.round.ready",
  "review.session.summary",
  "review.session.close",
] as const;

export type ReviewEventType = (typeof REVIEW_EVENT_TYPES)[number];

export interface ReviewSessionOpenPayload {
  initialRoundId: string;
  sourceScope: ReviewSourceScope;
}

export interface ReviewBatchSubmitPayload {
  roundId: string;
  threadIds: string[];
  draftCount: number;
  targetAgent: string;
}

export interface ReviewThreadReplyPayload {
  threadId: string;
  body: string;
  status?: ReviewThreadStatus;
}

export interface ReviewThreadAcceptPayload {
  threadId: string;
  note?: string;
}

export interface ReviewThreadReopenPayload {
  threadId: string;
  note?: string;
}

export interface ReviewThreadAddressedPayload {
  threadId: string;
  roundId?: string;
  note?: string;
}

export interface ReviewRoundRequestPayload {
  parentRoundId: string | null;
  sourceScope: ReviewSourceScope;
  affectedThreadIds: string[];
  summary: string;
}

export interface ReviewRoundReadyPayload {
  roundId: string;
  parentRoundId: string | null;
  changedFiles: string[];
  affectedThreadIds: string[];
  summary: string;
}

export interface ReviewSessionSummaryPayload {
  openThreads: number;
  addressedThreads: number;
  acceptedThreads: number;
  summary: string;
}

export interface ReviewSessionClosePayload {
  reason: "approved" | "abandoned" | "superseded" | "manual";
  note?: string;
}

export interface ReviewEventPayloadMap {
  "review.session.open": ReviewSessionOpenPayload;
  "review.batch.submit": ReviewBatchSubmitPayload;
  "review.thread.reply": ReviewThreadReplyPayload;
  "review.thread.accept": ReviewThreadAcceptPayload;
  "review.thread.reopen": ReviewThreadReopenPayload;
  "review.thread.addressed": ReviewThreadAddressedPayload;
  "review.round.request": ReviewRoundRequestPayload;
  "review.round.ready": ReviewRoundReadyPayload;
  "review.session.summary": ReviewSessionSummaryPayload;
  "review.session.close": ReviewSessionClosePayload;
}

export interface ReviewEvent<T extends ReviewEventType = ReviewEventType>
  extends DiffReviewRecord {
  id: string;
  sessionId: string;
  roundId: string | null;
  threadId: string | null;
  type: T;
  summary: string;
  actor: string;
  payload: ReviewEventPayloadMap[T];
  createdAt: ISODateString;
}

export type ReviewEntityKind =
  | "session"
  | "round"
  | "thread"
  | "event"
  | "snapshot";

const ENTITY_ID_PREFIX: Record<ReviewEntityKind, string> = {
  session: "drs",
  round: "drr",
  thread: "drt",
  event: "dre",
  snapshot: "drp",
};

export function nowIso(): ISODateString {
  return new Date().toISOString();
}

export function createReviewId(kind: ReviewEntityKind): string {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  return `${ENTITY_ID_PREFIX[kind]}_${suffix}`;
}

export interface CreateReviewSessionInput {
  id?: string;
  repoRoot: string;
  targetAgent: string;
  bridgeAgent: string;
  title: string;
  status?: ReviewSessionStatus;
  baselineSnapshotId: string;
  latestRoundId?: string | null;
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
}

export function createReviewSession(
  input: CreateReviewSessionInput
): ReviewSession {
  const createdAt = input.createdAt ?? nowIso();
  return {
    schemaVersion: DIFF_REVIEW_SCHEMA_VERSION,
    reviewKind: DIFF_REVIEW_KIND,
    id: input.id ?? createReviewId("session"),
    repoRoot: input.repoRoot,
    targetAgent: input.targetAgent,
    bridgeAgent: input.bridgeAgent,
    title: input.title,
    status: input.status ?? "open",
    baselineSnapshotId: input.baselineSnapshotId,
    latestRoundId: input.latestRoundId ?? null,
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
}

export interface CreateReviewRoundInput {
  id?: string;
  sessionId: string;
  parentRoundId?: string | null;
  kind: ReviewRoundKind;
  sourceScope: ReviewSourceScope;
  baseSnapshotId: string;
  headSnapshotId: string;
  changedFiles: string[];
  fileChanges?: ReviewFileChange[];
  affectedThreadIds?: string[];
  summary: string;
  requestedBy: string;
  createdAt?: ISODateString;
}

export function createReviewRound(input: CreateReviewRoundInput): ReviewRound {
  return {
    schemaVersion: DIFF_REVIEW_SCHEMA_VERSION,
    reviewKind: DIFF_REVIEW_KIND,
    id: input.id ?? createReviewId("round"),
    sessionId: input.sessionId,
    parentRoundId: input.parentRoundId ?? null,
    kind: input.kind,
    sourceScope: input.sourceScope,
    baseSnapshotId: input.baseSnapshotId,
    headSnapshotId: input.headSnapshotId,
    changedFiles: [...new Set(input.changedFiles)],
    fileChanges: input.fileChanges ?? [],
    affectedThreadIds: input.affectedThreadIds ?? [],
    summary: input.summary,
    requestedBy: input.requestedBy,
    createdAt: input.createdAt ?? nowIso(),
  };
}

export interface CreateReviewThreadInput {
  id?: string;
  sessionId: string;
  createdInRoundId: string;
  latestRoundId: string;
  path: string;
  anchor: ReviewThreadAnchor;
  status?: ReviewThreadStatus;
  stale?: boolean;
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
}

export function createReviewThread(
  input: CreateReviewThreadInput
): ReviewThread {
  const createdAt = input.createdAt ?? nowIso();
  return {
    schemaVersion: DIFF_REVIEW_SCHEMA_VERSION,
    reviewKind: DIFF_REVIEW_KIND,
    id: input.id ?? createReviewId("thread"),
    sessionId: input.sessionId,
    createdInRoundId: input.createdInRoundId,
    latestRoundId: input.latestRoundId,
    path: input.path,
    anchor: input.anchor,
    status: input.status ?? "open",
    stale: input.stale ?? false,
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
}

export interface CreateReviewSnapshotManifestInput {
  id?: string;
  sessionId: string;
  side: ReviewSnapshotSide;
  repoRoot: string;
  sourceScope: ReviewSourceScope;
  target: ReviewSnapshotTarget;
  files: ReviewSnapshotFile[];
  createdAt?: ISODateString;
}

export function createReviewSnapshotManifest(
  input: CreateReviewSnapshotManifestInput
): ReviewSnapshotManifest {
  return {
    schemaVersion: DIFF_REVIEW_SCHEMA_VERSION,
    reviewKind: DIFF_REVIEW_KIND,
    id: input.id ?? createReviewId("snapshot"),
    sessionId: input.sessionId,
    side: input.side,
    repoRoot: input.repoRoot,
    sourceScope: input.sourceScope,
    target: input.target,
    files: input.files,
    createdAt: input.createdAt ?? nowIso(),
  };
}

export interface CreateReviewEventInput<T extends ReviewEventType> {
  id?: string;
  sessionId: string;
  roundId?: string | null;
  threadId?: string | null;
  type: T;
  summary: string;
  actor: string;
  payload: ReviewEventPayloadMap[T];
  createdAt?: ISODateString;
}

export function createReviewEvent<T extends ReviewEventType>(
  input: CreateReviewEventInput<T>
): ReviewEvent<T> {
  return {
    schemaVersion: DIFF_REVIEW_SCHEMA_VERSION,
    reviewKind: DIFF_REVIEW_KIND,
    id: input.id ?? createReviewId("event"),
    sessionId: input.sessionId,
    roundId: input.roundId ?? null,
    threadId: input.threadId ?? null,
    type: input.type,
    summary: input.summary,
    actor: input.actor,
    payload: input.payload,
    createdAt: input.createdAt ?? nowIso(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isIsoDateString(value: unknown): value is ISODateString {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

function hasSchema(record: Record<string, unknown>): boolean {
  return (
    record.schemaVersion === DIFF_REVIEW_SCHEMA_VERSION &&
    record.reviewKind === DIFF_REVIEW_KIND
  );
}

function isReviewSourceScopeKind(value: unknown): value is ReviewSourceScopeKind {
  return (
    typeof value === "string" &&
    (REVIEW_SOURCE_SCOPE_KINDS as readonly string[]).includes(value)
  );
}

function isReviewFileChangeStatus(value: unknown): value is ReviewFileChangeStatus {
  return (
    typeof value === "string" &&
    (REVIEW_FILE_CHANGE_STATUSES as readonly string[]).includes(value)
  );
}

function isReviewSessionStatus(value: unknown): value is ReviewSessionStatus {
  return (
    typeof value === "string" &&
    (REVIEW_SESSION_STATUSES as readonly string[]).includes(value)
  );
}

function isReviewRoundKind(value: unknown): value is ReviewRoundKind {
  return (
    typeof value === "string" &&
    (REVIEW_ROUND_KINDS as readonly string[]).includes(value)
  );
}

function isReviewThreadStatus(value: unknown): value is ReviewThreadStatus {
  return (
    typeof value === "string" &&
    (REVIEW_THREAD_STATUSES as readonly string[]).includes(value)
  );
}

function isReviewAnchorSide(value: unknown): value is ReviewAnchorSide {
  return (
    typeof value === "string" &&
    (REVIEW_ANCHOR_SIDES as readonly string[]).includes(value)
  );
}

function isReviewSnapshotTargetKind(value: unknown): value is ReviewSnapshotTargetKind {
  return (
    typeof value === "string" &&
    (REVIEW_SNAPSHOT_TARGET_KINDS as readonly string[]).includes(value)
  );
}

function isReviewEventType(value: unknown): value is ReviewEventType {
  return (
    typeof value === "string" &&
    (REVIEW_EVENT_TYPES as readonly string[]).includes(value)
  );
}

export function isReviewSourceScope(value: unknown): value is ReviewSourceScope {
  if (!isRecord(value)) return false;
  if (!isReviewSourceScopeKind(value.kind)) return false;
  if (value.paths !== undefined && !isStringArray(value.paths)) return false;
  if (value.baseRef !== undefined && typeof value.baseRef !== "string") return false;
  if (value.headRef !== undefined && typeof value.headRef !== "string") return false;
  if (value.label !== undefined && typeof value.label !== "string") return false;
  return true;
}

export function isReviewFileChange(value: unknown): value is ReviewFileChange {
  if (!isRecord(value)) return false;
  if (typeof value.path !== "string" || value.path.length === 0) return false;
  if (!isReviewFileChangeStatus(value.status)) return false;
  if (value.previousPath !== undefined && typeof value.previousPath !== "string") {
    return false;
  }
  return true;
}

export function isReviewSession(value: unknown): value is ReviewSession {
  if (!isRecord(value) || !hasSchema(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (typeof value.repoRoot !== "string" || value.repoRoot.length === 0) return false;
  if (typeof value.targetAgent !== "string" || value.targetAgent.length === 0) {
    return false;
  }
  if (typeof value.bridgeAgent !== "string" || value.bridgeAgent.length === 0) {
    return false;
  }
  if (typeof value.title !== "string") return false;
  if (!isReviewSessionStatus(value.status)) return false;
  if (typeof value.baselineSnapshotId !== "string") return false;
  if (value.latestRoundId !== null && typeof value.latestRoundId !== "string") {
    return false;
  }
  if (!isIsoDateString(value.createdAt) || !isIsoDateString(value.updatedAt)) {
    return false;
  }
  return true;
}

export function isReviewRound(value: unknown): value is ReviewRound {
  if (!isRecord(value) || !hasSchema(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.sessionId !== "string") return false;
  if (value.parentRoundId !== null && typeof value.parentRoundId !== "string") {
    return false;
  }
  if (!isReviewRoundKind(value.kind)) return false;
  if (!isReviewSourceScope(value.sourceScope)) return false;
  if (typeof value.baseSnapshotId !== "string") return false;
  if (typeof value.headSnapshotId !== "string") return false;
  if (!isStringArray(value.changedFiles)) return false;
  if (!Array.isArray(value.fileChanges) || !value.fileChanges.every(isReviewFileChange)) {
    return false;
  }
  if (!isStringArray(value.affectedThreadIds)) return false;
  if (typeof value.summary !== "string") return false;
  if (typeof value.requestedBy !== "string") return false;
  if (!isIsoDateString(value.createdAt)) return false;
  return true;
}

export function isReviewThreadAnchor(value: unknown): value is ReviewThreadAnchor {
  if (!isRecord(value)) return false;
  if (!isReviewAnchorSide(value.side)) return false;
  if (value.startLine !== null && typeof value.startLine !== "number") return false;
  if (value.endLine !== null && typeof value.endLine !== "number") return false;
  if (value.contextBefore !== undefined && !isStringArray(value.contextBefore)) {
    return false;
  }
  if (value.contextAfter !== undefined && !isStringArray(value.contextAfter)) {
    return false;
  }
  return true;
}

export function isReviewThread(value: unknown): value is ReviewThread {
  if (!isRecord(value) || !hasSchema(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.sessionId !== "string") return false;
  if (typeof value.createdInRoundId !== "string") return false;
  if (typeof value.latestRoundId !== "string") return false;
  if (typeof value.path !== "string") return false;
  if (!isReviewThreadAnchor(value.anchor)) return false;
  if (!isReviewThreadStatus(value.status)) return false;
  if (typeof value.stale !== "boolean") return false;
  if (!isIsoDateString(value.createdAt) || !isIsoDateString(value.updatedAt)) {
    return false;
  }
  return true;
}

export function isReviewSnapshotTarget(value: unknown): value is ReviewSnapshotTarget {
  if (!isRecord(value)) return false;
  if (!isReviewSnapshotTargetKind(value.kind)) return false;
  if (value.ref !== null && typeof value.ref !== "string") return false;
  if (value.resolvedRef !== null && typeof value.resolvedRef !== "string") {
    return false;
  }
  return true;
}

export function isReviewSnapshotFile(value: unknown): value is ReviewSnapshotFile {
  if (!isRecord(value)) return false;
  if (typeof value.path !== "string") return false;
  if (typeof value.canonicalPath !== "string") return false;
  if (!isReviewFileChangeStatus(value.status)) return false;
  if (value.previousPath !== undefined && typeof value.previousPath !== "string") {
    return false;
  }
  if (typeof value.present !== "boolean") return false;
  if (typeof value.byteLength !== "number") return false;
  if (value.sha256 !== null && typeof value.sha256 !== "string") return false;
  if (value.storagePath !== null && typeof value.storagePath !== "string") return false;
  return true;
}

export function isReviewSnapshotManifest(
  value: unknown
): value is ReviewSnapshotManifest {
  if (!isRecord(value) || !hasSchema(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.sessionId !== "string") return false;
  if (value.side !== "base" && value.side !== "head") return false;
  if (typeof value.repoRoot !== "string") return false;
  if (!isReviewSourceScope(value.sourceScope)) return false;
  if (!isReviewSnapshotTarget(value.target)) return false;
  if (!Array.isArray(value.files) || !value.files.every(isReviewSnapshotFile)) {
    return false;
  }
  if (!isIsoDateString(value.createdAt)) return false;
  return true;
}

export function isReviewEvent(value: unknown): value is ReviewEvent {
  if (!isRecord(value) || !hasSchema(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.sessionId !== "string") return false;
  if (value.roundId !== null && typeof value.roundId !== "string") return false;
  if (value.threadId !== null && typeof value.threadId !== "string") return false;
  if (!isReviewEventType(value.type)) return false;
  if (typeof value.summary !== "string") return false;
  if (typeof value.actor !== "string") return false;
  if (!isRecord(value.payload)) return false;
  if (!isIsoDateString(value.createdAt)) return false;
  return true;
}

export function assertReviewSession(
  value: unknown,
  context = "ReviewSession"
): ReviewSession {
  if (!isReviewSession(value)) {
    throw new Error(`${context} failed diff-review schema validation`);
  }
  return value;
}

export function assertReviewRound(
  value: unknown,
  context = "ReviewRound"
): ReviewRound {
  if (!isReviewRound(value)) {
    throw new Error(`${context} failed diff-review schema validation`);
  }
  return value;
}

export function assertReviewThread(
  value: unknown,
  context = "ReviewThread"
): ReviewThread {
  if (!isReviewThread(value)) {
    throw new Error(`${context} failed diff-review schema validation`);
  }
  return value;
}

export function assertReviewSnapshotManifest(
  value: unknown,
  context = "ReviewSnapshotManifest"
): ReviewSnapshotManifest {
  if (!isReviewSnapshotManifest(value)) {
    throw new Error(`${context} failed diff-review schema validation`);
  }
  return value;
}

export function assertReviewEvent(
  value: unknown,
  context = "ReviewEvent"
): ReviewEvent {
  if (!isReviewEvent(value)) {
    throw new Error(`${context} failed diff-review schema validation`);
  }
  return value;
}
