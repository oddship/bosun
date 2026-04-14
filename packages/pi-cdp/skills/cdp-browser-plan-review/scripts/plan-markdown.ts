import { buildPlanDiff, type PlanBlockChangeKind } from "./plan-diff";
import type { PlanDocumentAnchor, PlanReviewDocument, PlanReviewSession } from "./session-types";

export type PlanReviewViewMode = "delta" | "full";

export interface PlanBlockView {
  id: string;
  headingPath: string[];
  headingLabel: string;
  blockKind: string;
  text: string;
  lineStart: number | null;
  lineEnd: number | null;
  changeKind: PlanBlockChangeKind;
}

export interface PlanReviewViewModel {
  title: string;
  planFilePath: string;
  sessionId: string;
  status: string;
  mode: PlanReviewViewMode;
  availableModes: PlanReviewViewMode[];
  blocks: PlanBlockView[];
  diffSummary: {
    previousAnchorCount: number;
    currentAnchorCount: number;
    deltaCount: number;
    removedCount: number;
  };
}

export interface BuildPlanReviewViewModelOptions {
  mode?: PlanReviewViewMode;
  previousAnchors?: PlanDocumentAnchor[];
}

function headingLabel(parts: string[]): string {
  return parts.length ? parts.join(" / ") : "(root)";
}

export function buildPlanBlockViews(
  document: PlanReviewDocument,
  options: BuildPlanReviewViewModelOptions = {},
): PlanBlockView[] {
  const previousAnchors = options.previousAnchors ?? [];
  const diff = buildPlanDiff(previousAnchors, document.anchors);
  const requestedMode = options.mode ?? (previousAnchors.length > 0 ? "delta" : "full");
  const mode: PlanReviewViewMode = requestedMode === "delta" && previousAnchors.length > 0
    ? "delta"
    : "full";

  return document.anchors
    .filter((anchor) => mode === "full" || diff.changeByAnchorId[anchor.id] !== "unchanged")
    .map((anchor) => ({
      id: anchor.id,
      headingPath: anchor.headingPath,
      headingLabel: headingLabel(anchor.headingPath),
      blockKind: anchor.blockKind,
      text: anchor.text,
      lineStart: anchor.lineStart,
      lineEnd: anchor.lineEnd,
      changeKind: diff.changeByAnchorId[anchor.id],
    }));
}

export function buildPlanReviewViewModel(
  session: PlanReviewSession,
  document: PlanReviewDocument,
  options: BuildPlanReviewViewModelOptions = {},
): PlanReviewViewModel {
  const previousAnchors = options.previousAnchors ?? [];
  const diff = buildPlanDiff(previousAnchors, document.anchors);
  const requestedMode = options.mode ?? (previousAnchors.length > 0 ? "delta" : "full");
  const mode: PlanReviewViewMode = requestedMode === "delta" && previousAnchors.length > 0
    ? "delta"
    : "full";

  return {
    title: document.title || session.title,
    planFilePath: document.planFilePath,
    sessionId: session.id,
    status: session.status,
    mode,
    availableModes: previousAnchors.length > 0 ? ["delta", "full"] : ["full"],
    blocks: buildPlanBlockViews(document, { previousAnchors, mode }),
    diffSummary: {
      previousAnchorCount: diff.previousAnchorCount,
      currentAnchorCount: diff.currentAnchorCount,
      deltaCount: diff.deltaAnchorIds.length,
      removedCount: diff.removedAnchors.length,
    },
  };
}
