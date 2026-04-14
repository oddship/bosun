import { randomUUID } from "node:crypto";

export const PLAN_REVIEW_SCHEMA_VERSION = 1 as const;
export const PLAN_REVIEW_KIND = "plan-review" as const;

export type ISODateString = string;

export interface PlanReviewRecord {
  schemaVersion: typeof PLAN_REVIEW_SCHEMA_VERSION;
  reviewKind: typeof PLAN_REVIEW_KIND;
}

export const PLAN_REVIEW_SESSION_STATUSES = [
  "open",
  "waiting",
  "ready",
  "closed",
] as const;

export type PlanReviewSessionStatus =
  (typeof PLAN_REVIEW_SESSION_STATUSES)[number];

export const PLAN_REVIEW_OUTCOMES = ["approve", "request_changes"] as const;

export type PlanReviewOutcome = (typeof PLAN_REVIEW_OUTCOMES)[number];

export const PLAN_REVIEW_THREAD_STATUSES = [
  "open",
  "addressed",
  "accepted",
] as const;

export type PlanReviewThreadStatus =
  (typeof PLAN_REVIEW_THREAD_STATUSES)[number];

export const PLAN_REVIEW_BLOCK_KINDS = [
  "paragraph",
  "checklist_item",
  "list_item",
  "heading",
  "code_block",
  "table",
  "quote",
  "global",
] as const;

export type PlanReviewBlockKind = (typeof PLAN_REVIEW_BLOCK_KINDS)[number];

export interface PlanReviewAnchor {
  headingPath: string[];
  blockKind: PlanReviewBlockKind;
  blockIndexPath: number[];
  quote: string | null;
  lineStart: number | null;
  lineEnd: number | null;
}

export interface PlanDocumentAnchor extends PlanReviewAnchor {
  id: string;
  text: string;
}

export interface PlanReviewSession extends PlanReviewRecord {
  id: string;
  planFilePath: string;
  targetAgent: string;
  bridgeAgent: string;
  title: string;
  status: PlanReviewSessionStatus;
  latestSnapshotId: string;
  latestSubmissionId: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface PlanReviewSnapshot extends PlanReviewRecord {
  id: string;
  sessionId: string;
  planFilePath: string;
  source: "initial" | "reround";
  storagePath: string;
  sha256: string;
  byteLength: number;
  lineCount: number;
  createdAt: ISODateString;
}

export interface PlanReviewDocument extends PlanReviewRecord {
  sessionId: string;
  planFilePath: string;
  title: string;
  currentSnapshotId: string;
  anchorCount: number;
  lineCount: number;
  anchors: PlanDocumentAnchor[];
  snapshots: PlanReviewSnapshot[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface PlanReviewFeedbackItem extends PlanReviewRecord {
  id: string;
  threadId: string | null;
  anchor: PlanReviewAnchor;
  comment: string;
  suggestion: string | null;
  createdAt: ISODateString;
}

export interface PlanReviewThread extends PlanReviewRecord {
  id: string;
  sessionId: string;
  createdInSnapshotId: string;
  latestSnapshotId: string;
  anchor: PlanReviewAnchor;
  comment: string;
  suggestion: string | null;
  status: PlanReviewThreadStatus;
  stale: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface PlanReviewSubmission extends PlanReviewRecord {
  id: string;
  sessionId: string;
  snapshotId: string;
  outcome: PlanReviewOutcome;
  feedbackCount: number;
  summary: string;
  feedback: PlanReviewFeedbackItem[];
  actor: string;
  targetAgent: string;
  createdAt: ISODateString;
}

export const PLAN_REVIEW_EVENT_TYPES = [
  "review.session.open",
  "review.submission.create",
  "review.result.ready",
  "review.thread.accept",
  "review.thread.reopen",
  "review.session.close",
  "review.reround.request",
  "review.reround.ready",
] as const;

export type PlanReviewEventType = (typeof PLAN_REVIEW_EVENT_TYPES)[number];

export interface PlanReviewSessionOpenPayload {
  snapshotId: string;
  planFilePath: string;
  targetAgent: string;
}

export interface PlanReviewSubmissionCreatePayload {
  submissionId: string;
  snapshotId: string;
  outcome: PlanReviewOutcome;
  feedbackCount: number;
  targetAgent: string;
}

export interface PlanReviewResultReadyPayload {
  submissionId: string;
  outcome: PlanReviewOutcome;
  feedbackCount: number;
  summary: string;
  targetAgent: string;
}

export interface PlanReviewThreadAcceptPayload {
  threadId: string;
  note?: string;
}

export interface PlanReviewThreadReopenPayload {
  threadId: string;
  note?: string;
}

export interface PlanReviewSessionClosePayload {
  reason: "approved" | "abandoned" | "superseded" | "manual";
  note?: string;
}

export interface PlanReviewReroundRequestPayload {
  parentSnapshotId: string;
  requestedBy: string;
  summary: string;
}

export interface PlanReviewReroundReadyPayload {
  parentSnapshotId: string;
  snapshotId: string;
  summary: string;
}

export interface PlanReviewEventPayloadMap {
  "review.session.open": PlanReviewSessionOpenPayload;
  "review.submission.create": PlanReviewSubmissionCreatePayload;
  "review.result.ready": PlanReviewResultReadyPayload;
  "review.thread.accept": PlanReviewThreadAcceptPayload;
  "review.thread.reopen": PlanReviewThreadReopenPayload;
  "review.session.close": PlanReviewSessionClosePayload;
  "review.reround.request": PlanReviewReroundRequestPayload;
  "review.reround.ready": PlanReviewReroundReadyPayload;
}

export interface PlanReviewEvent<
  T extends PlanReviewEventType = PlanReviewEventType,
> extends PlanReviewRecord {
  id: string;
  sessionId: string;
  submissionId: string | null;
  threadId: string | null;
  type: T;
  summary: string;
  actor: string;
  payload: PlanReviewEventPayloadMap[T];
  createdAt: ISODateString;
}

interface CreateSessionInput {
  id?: string;
  planFilePath: string;
  targetAgent: string;
  bridgeAgent: string;
  title: string;
  latestSnapshotId: string;
  latestSubmissionId?: string | null;
  status?: PlanReviewSessionStatus;
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
}

interface CreateDocumentInput {
  sessionId: string;
  planFilePath: string;
  title: string;
  currentSnapshotId: string;
  anchors: PlanDocumentAnchor[];
  snapshots: PlanReviewSnapshot[];
  lineCount: number;
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
}

interface CreateSnapshotInput {
  id?: string;
  sessionId: string;
  planFilePath: string;
  source?: "initial" | "reround";
  storagePath: string;
  sha256: string;
  byteLength: number;
  lineCount: number;
  createdAt?: ISODateString;
}

interface CreateFeedbackItemInput {
  id?: string;
  threadId?: string | null;
  anchor: PlanReviewAnchor;
  comment: string;
  suggestion?: string | null;
  createdAt?: ISODateString;
}

interface CreateThreadInput {
  id?: string;
  sessionId: string;
  createdInSnapshotId: string;
  latestSnapshotId: string;
  anchor: PlanReviewAnchor;
  comment: string;
  suggestion?: string | null;
  status?: PlanReviewThreadStatus;
  stale?: boolean;
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
}

interface CreateSubmissionInput {
  id?: string;
  sessionId: string;
  snapshotId: string;
  outcome: PlanReviewOutcome;
  summary: string;
  feedback: PlanReviewFeedbackItem[];
  actor: string;
  targetAgent: string;
  createdAt?: ISODateString;
}

interface CreateEventInput<T extends PlanReviewEventType> {
  id?: string;
  sessionId: string;
  submissionId?: string | null;
  threadId?: string | null;
  type: T;
  summary: string;
  actor: string;
  payload: PlanReviewEventPayloadMap[T];
  createdAt?: ISODateString;
}

function createBaseRecord(): PlanReviewRecord {
  return {
    schemaVersion: PLAN_REVIEW_SCHEMA_VERSION,
    reviewKind: PLAN_REVIEW_KIND,
  };
}

export function nowIso(): ISODateString {
  return new Date().toISOString();
}

export function createPlanReviewId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function createPlanReviewSession(
  input: CreateSessionInput,
): PlanReviewSession {
  const createdAt = input.createdAt ?? nowIso();
  return {
    ...createBaseRecord(),
    id: input.id ?? createPlanReviewId("session"),
    planFilePath: input.planFilePath,
    targetAgent: input.targetAgent,
    bridgeAgent: input.bridgeAgent,
    title: input.title,
    status: input.status ?? "open",
    latestSnapshotId: input.latestSnapshotId,
    latestSubmissionId: input.latestSubmissionId ?? null,
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
}

export function createPlanReviewSnapshot(
  input: CreateSnapshotInput,
): PlanReviewSnapshot {
  return {
    ...createBaseRecord(),
    id: input.id ?? createPlanReviewId("snapshot"),
    sessionId: input.sessionId,
    planFilePath: input.planFilePath,
    source: input.source ?? "initial",
    storagePath: input.storagePath,
    sha256: input.sha256,
    byteLength: input.byteLength,
    lineCount: input.lineCount,
    createdAt: input.createdAt ?? nowIso(),
  };
}

export function createPlanReviewDocument(
  input: CreateDocumentInput,
): PlanReviewDocument {
  const createdAt = input.createdAt ?? nowIso();
  return {
    ...createBaseRecord(),
    sessionId: input.sessionId,
    planFilePath: input.planFilePath,
    title: input.title,
    currentSnapshotId: input.currentSnapshotId,
    anchorCount: input.anchors.length,
    lineCount: input.lineCount,
    anchors: input.anchors,
    snapshots: input.snapshots,
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
}

export function createPlanReviewFeedbackItem(
  input: CreateFeedbackItemInput,
): PlanReviewFeedbackItem {
  return {
    ...createBaseRecord(),
    id: input.id ?? createPlanReviewId("feedback"),
    threadId: input.threadId ?? null,
    anchor: input.anchor,
    comment: input.comment,
    suggestion: input.suggestion ?? null,
    createdAt: input.createdAt ?? nowIso(),
  };
}

export function createPlanReviewThread(
  input: CreateThreadInput,
): PlanReviewThread {
  const createdAt = input.createdAt ?? nowIso();
  return {
    ...createBaseRecord(),
    id: input.id ?? createPlanReviewId("thread"),
    sessionId: input.sessionId,
    createdInSnapshotId: input.createdInSnapshotId,
    latestSnapshotId: input.latestSnapshotId,
    anchor: input.anchor,
    comment: input.comment,
    suggestion: input.suggestion ?? null,
    status: input.status ?? "open",
    stale: input.stale ?? false,
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
}

export function createPlanReviewSubmission(
  input: CreateSubmissionInput,
): PlanReviewSubmission {
  return {
    ...createBaseRecord(),
    id: input.id ?? createPlanReviewId("submission"),
    sessionId: input.sessionId,
    snapshotId: input.snapshotId,
    outcome: input.outcome,
    feedbackCount: input.feedback.length,
    summary: input.summary,
    feedback: input.feedback,
    actor: input.actor,
    targetAgent: input.targetAgent,
    createdAt: input.createdAt ?? nowIso(),
  };
}

export function createPlanReviewEvent<T extends PlanReviewEventType>(
  input: CreateEventInput<T>,
): PlanReviewEvent<T> {
  return {
    ...createBaseRecord(),
    id: input.id ?? createPlanReviewId("event"),
    sessionId: input.sessionId,
    submissionId: input.submissionId ?? null,
    threadId: input.threadId ?? null,
    type: input.type,
    summary: input.summary,
    actor: input.actor,
    payload: input.payload,
    createdAt: input.createdAt ?? nowIso(),
  };
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertNullableString(
  value: unknown,
  label: string,
): asserts value is string | null {
  if (value !== null && typeof value !== "string") {
    throw new Error(`${label} must be a string or null`);
  }
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
}

function assertObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertEnumValue<T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): asserts value is T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${label} must be one of: ${values.join(", ")}`);
  }
}

function assertBaseRecord(
  value: unknown,
  label: string,
): asserts value is PlanReviewRecord {
  assertObject(value, label);
  if (value.schemaVersion !== PLAN_REVIEW_SCHEMA_VERSION) {
    throw new Error(`${label}.schemaVersion must be ${PLAN_REVIEW_SCHEMA_VERSION}`);
  }
  if (value.reviewKind !== PLAN_REVIEW_KIND) {
    throw new Error(`${label}.reviewKind must be ${PLAN_REVIEW_KIND}`);
  }
}

export function assertPlanReviewAnchor(
  value: unknown,
  label: string = "anchor",
): asserts value is PlanReviewAnchor {
  assertObject(value, label);
  assertArray(value.headingPath, `${label}.headingPath`);
  assertEnumValue(value.blockKind, PLAN_REVIEW_BLOCK_KINDS, `${label}.blockKind`);
  assertArray(value.blockIndexPath, `${label}.blockIndexPath`);
  assertNullableString(value.quote, `${label}.quote`);
  if (value.lineStart !== null && value.lineStart !== undefined && typeof value.lineStart !== "number") {
    throw new Error(`${label}.lineStart must be a number or null`);
  }
  if (value.lineEnd !== null && value.lineEnd !== undefined && typeof value.lineEnd !== "number") {
    throw new Error(`${label}.lineEnd must be a number or null`);
  }
}

export function assertPlanDocumentAnchor(
  value: unknown,
  label: string = "documentAnchor",
): asserts value is PlanDocumentAnchor {
  assertPlanReviewAnchor(value, label);
  assertObject(value, label);
  assertString(value.id, `${label}.id`);
  assertString(value.text, `${label}.text`);
}

export function assertPlanReviewSession(
  value: unknown,
  label: string = "session",
): asserts value is PlanReviewSession {
  assertBaseRecord(value, label);
  assertString(value.id, `${label}.id`);
  assertString(value.planFilePath, `${label}.planFilePath`);
  assertString(value.targetAgent, `${label}.targetAgent`);
  assertString(value.bridgeAgent, `${label}.bridgeAgent`);
  assertString(value.title, `${label}.title`);
  assertEnumValue(value.status, PLAN_REVIEW_SESSION_STATUSES, `${label}.status`);
  assertString(value.latestSnapshotId, `${label}.latestSnapshotId`);
  assertNullableString(value.latestSubmissionId, `${label}.latestSubmissionId`);
  assertString(value.createdAt, `${label}.createdAt`);
  assertString(value.updatedAt, `${label}.updatedAt`);
}

export function assertPlanReviewSnapshot(
  value: unknown,
  label: string = "snapshot",
): asserts value is PlanReviewSnapshot {
  assertBaseRecord(value, label);
  assertString(value.id, `${label}.id`);
  assertString(value.sessionId, `${label}.sessionId`);
  assertString(value.planFilePath, `${label}.planFilePath`);
  assertEnumValue(value.source, ["initial", "reround"] as const, `${label}.source`);
  assertString(value.storagePath, `${label}.storagePath`);
  assertString(value.sha256, `${label}.sha256`);
  if (typeof value.byteLength !== "number") {
    throw new Error(`${label}.byteLength must be a number`);
  }
  if (typeof value.lineCount !== "number") {
    throw new Error(`${label}.lineCount must be a number`);
  }
  assertString(value.createdAt, `${label}.createdAt`);
}

export function assertPlanReviewDocument(
  value: unknown,
  label: string = "document",
): asserts value is PlanReviewDocument {
  assertBaseRecord(value, label);
  assertString(value.sessionId, `${label}.sessionId`);
  assertString(value.planFilePath, `${label}.planFilePath`);
  assertString(value.title, `${label}.title`);
  assertString(value.currentSnapshotId, `${label}.currentSnapshotId`);
  if (typeof value.anchorCount !== "number") {
    throw new Error(`${label}.anchorCount must be a number`);
  }
  if (typeof value.lineCount !== "number") {
    throw new Error(`${label}.lineCount must be a number`);
  }
  assertArray(value.anchors, `${label}.anchors`);
  value.anchors.forEach((anchor, index) =>
    assertPlanDocumentAnchor(anchor, `${label}.anchors[${index}]`),
  );
  assertArray(value.snapshots, `${label}.snapshots`);
  value.snapshots.forEach((snapshot, index) =>
    assertPlanReviewSnapshot(snapshot, `${label}.snapshots[${index}]`),
  );
  assertString(value.createdAt, `${label}.createdAt`);
  assertString(value.updatedAt, `${label}.updatedAt`);
}

export function assertPlanReviewFeedbackItem(
  value: unknown,
  label: string = "feedbackItem",
): asserts value is PlanReviewFeedbackItem {
  assertBaseRecord(value, label);
  assertString(value.id, `${label}.id`);
  assertNullableString(value.threadId, `${label}.threadId`);
  assertPlanReviewAnchor(value.anchor, `${label}.anchor`);
  assertString(value.comment, `${label}.comment`);
  assertNullableString(value.suggestion, `${label}.suggestion`);
  assertString(value.createdAt, `${label}.createdAt`);
}

export function assertPlanReviewThread(
  value: unknown,
  label: string = "thread",
): asserts value is PlanReviewThread {
  assertBaseRecord(value, label);
  assertString(value.id, `${label}.id`);
  assertString(value.sessionId, `${label}.sessionId`);
  assertString(value.createdInSnapshotId, `${label}.createdInSnapshotId`);
  assertString(value.latestSnapshotId, `${label}.latestSnapshotId`);
  assertPlanReviewAnchor(value.anchor, `${label}.anchor`);
  assertString(value.comment, `${label}.comment`);
  assertNullableString(value.suggestion, `${label}.suggestion`);
  assertEnumValue(value.status, PLAN_REVIEW_THREAD_STATUSES, `${label}.status`);
  if (typeof value.stale !== "boolean") {
    throw new Error(`${label}.stale must be a boolean`);
  }
  assertString(value.createdAt, `${label}.createdAt`);
  assertString(value.updatedAt, `${label}.updatedAt`);
}

export function assertPlanReviewSubmission(
  value: unknown,
  label: string = "submission",
): asserts value is PlanReviewSubmission {
  assertBaseRecord(value, label);
  assertString(value.id, `${label}.id`);
  assertString(value.sessionId, `${label}.sessionId`);
  assertString(value.snapshotId, `${label}.snapshotId`);
  assertEnumValue(value.outcome, PLAN_REVIEW_OUTCOMES, `${label}.outcome`);
  if (typeof value.feedbackCount !== "number") {
    throw new Error(`${label}.feedbackCount must be a number`);
  }
  assertString(value.summary, `${label}.summary`);
  assertArray(value.feedback, `${label}.feedback`);
  value.feedback.forEach((item, index) =>
    assertPlanReviewFeedbackItem(item, `${label}.feedback[${index}]`),
  );
  assertString(value.actor, `${label}.actor`);
  assertString(value.targetAgent, `${label}.targetAgent`);
  assertString(value.createdAt, `${label}.createdAt`);
}

export function assertPlanReviewEvent(
  value: unknown,
  label: string = "event",
): asserts value is PlanReviewEvent {
  assertBaseRecord(value, label);
  assertString(value.id, `${label}.id`);
  assertString(value.sessionId, `${label}.sessionId`);
  assertNullableString(value.submissionId, `${label}.submissionId`);
  assertNullableString(value.threadId, `${label}.threadId`);
  assertEnumValue(value.type, PLAN_REVIEW_EVENT_TYPES, `${label}.type`);
  assertString(value.summary, `${label}.summary`);
  assertString(value.actor, `${label}.actor`);
  assertObject(value.payload, `${label}.payload`);
  assertString(value.createdAt, `${label}.createdAt`);
}
