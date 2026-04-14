import type {
  PlanDocumentAnchor,
  PlanReviewAnchor,
  PlanReviewThread,
} from "./session-types";

export type PlanBlockChangeKind = "unchanged" | "added" | "modified";
export type PlanThreadMatchKind = "exact" | "fuzzy" | "block-index" | "stale";

export interface PlanDiffResult {
  previousAnchorCount: number;
  currentAnchorCount: number;
  deltaAnchorIds: string[];
  changeByAnchorId: Record<string, PlanBlockChangeKind>;
  removedAnchors: PlanDocumentAnchor[];
}

export interface ThreadReroundUpdate {
  threadId: string;
  anchor: PlanReviewAnchor;
  stale: boolean;
  matchKind: PlanThreadMatchKind;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function stableHeadingPath(headingPath: string[]): string[] {
  return headingPath.length > 1 ? headingPath.slice(1) : headingPath;
}

function headingPathEquals(a: string[], b: string[]): boolean {
  return JSON.stringify(stableHeadingPath(a)) === JSON.stringify(stableHeadingPath(b));
}

function exactKey(anchor: Pick<PlanDocumentAnchor, "headingPath" | "blockKind" | "text">): string {
  return [anchor.blockKind, stableHeadingPath(anchor.headingPath).join(" > "), normalizeText(anchor.text)].join("||");
}

function coarseKey(
  anchor: Pick<PlanDocumentAnchor, "headingPath" | "blockKind">,
): string {
  return [anchor.blockKind, stableHeadingPath(anchor.headingPath).join(" > ")].join("||");
}

function tokenize(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  );
}

function similarity(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  return (2 * overlap) / (aTokens.size + bTokens.size);
}

function bestModifiedMatch(
  previous: PlanDocumentAnchor,
  candidates: PlanDocumentAnchor[],
): PlanDocumentAnchor | null {
  let best: PlanDocumentAnchor | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = similarity(previous.text, candidate.text);
    const prevText = normalizeText(previous.text);
    const nextText = normalizeText(candidate.text);
    const containsMatch =
      prevText.length >= 24 && nextText.length >= 24 &&
      (prevText.includes(nextText) || nextText.includes(prevText));
    const threshold = containsMatch ? 0.35 : 0.55;
    if (score >= threshold && score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function pickRemovedAnchors(
  previousAnchors: PlanDocumentAnchor[],
  matchedPreviousIds: Set<string>,
): PlanDocumentAnchor[] {
  return previousAnchors.filter((anchor) => !matchedPreviousIds.has(anchor.id));
}

export function buildPlanDiff(
  previousAnchors: PlanDocumentAnchor[],
  currentAnchors: PlanDocumentAnchor[],
): PlanDiffResult {
  if (previousAnchors.length === 0) {
    return {
      previousAnchorCount: 0,
      currentAnchorCount: currentAnchors.length,
      deltaAnchorIds: currentAnchors.map((anchor) => anchor.id),
      changeByAnchorId: Object.fromEntries(
        currentAnchors.map((anchor) => [anchor.id, "added"]),
      ),
      removedAnchors: [],
    };
  }

  const previousByExact = new Map<string, PlanDocumentAnchor[]>();
  const currentByExact = new Map<string, PlanDocumentAnchor[]>();
  const remainingCurrentByCoarse = new Map<string, PlanDocumentAnchor[]>();
  for (const anchor of previousAnchors) {
    const key = exactKey(anchor);
    previousByExact.set(key, [...(previousByExact.get(key) ?? []), anchor]);
  }
  for (const anchor of currentAnchors) {
    const key = exactKey(anchor);
    currentByExact.set(key, [...(currentByExact.get(key) ?? []), anchor]);
    const coarse = coarseKey(anchor);
    remainingCurrentByCoarse.set(coarse, [...(remainingCurrentByCoarse.get(coarse) ?? []), anchor]);
  }

  const matchedPreviousIds = new Set<string>();
  const matchedCurrentIds = new Set<string>();
  const changeByAnchorId: Record<string, PlanBlockChangeKind> = {};

  for (const [key, previousGroup] of previousByExact.entries()) {
    const currentGroup = currentByExact.get(key) ?? [];
    if (previousGroup.length === 1 && currentGroup.length === 1) {
      matchedPreviousIds.add(previousGroup[0].id);
      matchedCurrentIds.add(currentGroup[0].id);
      changeByAnchorId[currentGroup[0].id] = "unchanged";
      const coarse = coarseKey(currentGroup[0]);
      remainingCurrentByCoarse.set(
        coarse,
        (remainingCurrentByCoarse.get(coarse) ?? []).filter(
          (anchor) => anchor.id !== currentGroup[0].id,
        ),
      );
    }
  }

  for (const previous of previousAnchors) {
    if (matchedPreviousIds.has(previous.id)) continue;
    const coarse = coarseKey(previous);
    const candidates = (remainingCurrentByCoarse.get(coarse) ?? []).filter(
      (anchor) => !matchedCurrentIds.has(anchor.id),
    );
    const match = bestModifiedMatch(previous, candidates);
    if (!match) continue;
    matchedPreviousIds.add(previous.id);
    matchedCurrentIds.add(match.id);
    changeByAnchorId[match.id] = "modified";
    remainingCurrentByCoarse.set(
      coarse,
      candidates.filter((anchor) => anchor.id !== match.id),
    );
  }

  for (const anchor of currentAnchors) {
    if (!changeByAnchorId[anchor.id]) {
      changeByAnchorId[anchor.id] = "added";
    }
  }

  return {
    previousAnchorCount: previousAnchors.length,
    currentAnchorCount: currentAnchors.length,
    deltaAnchorIds: currentAnchors
      .filter((anchor) => changeByAnchorId[anchor.id] !== "unchanged")
      .map((anchor) => anchor.id),
    changeByAnchorId,
    removedAnchors: pickRemovedAnchors(previousAnchors, matchedPreviousIds),
  };
}

export function documentAnchorToReviewAnchor(anchor: PlanDocumentAnchor): PlanReviewAnchor {
  return {
    headingPath: [...anchor.headingPath],
    blockKind: anchor.blockKind,
    blockIndexPath: [...anchor.blockIndexPath],
    quote: anchor.quote,
    lineStart: anchor.lineStart,
    lineEnd: anchor.lineEnd,
  };
}

function findThreadAnchorMatch(
  thread: PlanReviewThread,
  currentAnchors: PlanDocumentAnchor[],
): { anchor: PlanDocumentAnchor | null; matchKind: PlanThreadMatchKind } {
  const threadQuote = normalizeText(thread.anchor.quote);

  const exact = currentAnchors.find(
    (anchor) =>
      anchor.blockKind === thread.anchor.blockKind &&
      headingPathEquals(anchor.headingPath, thread.anchor.headingPath) &&
      normalizeText(anchor.quote) === threadQuote,
  );
  if (exact) return { anchor: exact, matchKind: "exact" };

  const byBlockIndex = currentAnchors.find(
    (anchor) =>
      anchor.blockKind === thread.anchor.blockKind &&
      headingPathEquals(anchor.headingPath, thread.anchor.headingPath) &&
      JSON.stringify(anchor.blockIndexPath) === JSON.stringify(thread.anchor.blockIndexPath),
  );
  if (byBlockIndex) return { anchor: byBlockIndex, matchKind: "block-index" };

  const scoped = currentAnchors.filter(
    (anchor) =>
      anchor.blockKind === thread.anchor.blockKind &&
      headingPathEquals(anchor.headingPath, thread.anchor.headingPath),
  );
  let best: PlanDocumentAnchor | null = null;
  let bestScore = 0;
  for (const candidate of scoped) {
    const score = similarity(thread.anchor.quote ?? "", candidate.text);
    if (score >= 0.55 && score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (best) return { anchor: best, matchKind: "fuzzy" };

  return { anchor: null, matchKind: "stale" };
}

export function reconcileThreadsForReround(
  threads: PlanReviewThread[],
  currentAnchors: PlanDocumentAnchor[],
): ThreadReroundUpdate[] {
  return threads.map((thread) => {
    const match = findThreadAnchorMatch(thread, currentAnchors);
    if (!match.anchor) {
      return {
        threadId: thread.id,
        anchor: thread.anchor,
        stale: true,
        matchKind: "stale",
      };
    }

    return {
      threadId: thread.id,
      anchor: documentAnchorToReviewAnchor(match.anchor),
      stale: false,
      matchKind: match.matchKind,
    };
  });
}
