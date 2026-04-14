import { createHash } from "node:crypto";

import type {
  PlanDocumentAnchor,
  PlanReviewBlockKind,
} from "./session-types";

export interface ParsedPlanDocument {
  anchors: PlanDocumentAnchor[];
  lineCount: number;
  title: string | null;
}

interface FrontmatterResult {
  contentLines: string[];
  lineOffset: number;
}

function normalizeLineEndings(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

function stripFrontmatter(markdown: string): FrontmatterResult {
  const lines = normalizeLineEndings(markdown).split("\n");
  if (lines[0] !== "---") {
    return { contentLines: lines, lineOffset: 0 };
  }

  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      return {
        contentLines: lines.slice(i + 1),
        lineOffset: i + 1,
      };
    }
  }

  return { contentLines: lines, lineOffset: 0 };
}

function normalizeText(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function createAnchorId(input: {
  headingPath: string[];
  blockKind: PlanReviewBlockKind;
  blockIndexPath: number[];
  quote: string | null;
  lineStart: number | null;
  lineEnd: number | null;
}): string {
  const digest = createHash("sha1")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 12);
  return `anchor_${digest}`;
}

function sectionKey(headingPath: string[]): string {
  return headingPath.join(" > ") || "__root__";
}

function nextBlockIndex(
  counters: Map<string, number>,
  headingPath: string[],
): number[] {
  const key = sectionKey(headingPath);
  const next = (counters.get(key) ?? 0) + 1;
  counters.set(key, next);
  return [next];
}

function buildAnchor(params: {
  headingPath: string[];
  blockKind: PlanReviewBlockKind;
  blockIndexPath: number[];
  text: string;
  lineStart: number | null;
  lineEnd: number | null;
}): PlanDocumentAnchor {
  const quote = params.text.trim() ? params.text.trim() : null;
  return {
    id: createAnchorId({
      headingPath: params.headingPath,
      blockKind: params.blockKind,
      blockIndexPath: params.blockIndexPath,
      quote,
      lineStart: params.lineStart,
      lineEnd: params.lineEnd,
    }),
    headingPath: [...params.headingPath],
    blockKind: params.blockKind,
    blockIndexPath: [...params.blockIndexPath],
    quote,
    lineStart: params.lineStart,
    lineEnd: params.lineEnd,
    text: params.text,
  };
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line);
}

function isCodeFence(line: string): boolean {
  return /^(```|~~~)/.test(line.trim());
}

function isChecklistItem(line: string): boolean {
  return /^\s*(?:[-*+]|\d+\.)\s+\[(?: |x|X)\]\s+/.test(line);
}

function isListItem(line: string): boolean {
  return /^\s*(?:[-*+]|\d+\.)\s+/.test(line) && !isChecklistItem(line);
}

function isQuote(line: string): boolean {
  return /^\s*>/.test(line);
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && trimmed.replace(/[|:\-\s]/g, "").length > 0;
}

function isTableSeparator(line: string): boolean {
  return /^[\s|:-]+$/.test(line.trim()) && line.includes("-");
}

function isSpecialBlockStart(line: string): boolean {
  return (
    isHeading(line) ||
    isCodeFence(line) ||
    isChecklistItem(line) ||
    isListItem(line) ||
    isQuote(line) ||
    isTableRow(line)
  );
}

function stripListMarker(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+\.)\s+\[(?: |x|X)\]\s+/, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
    .trim();
}

function stripQuoteMarker(line: string): string {
  return line.replace(/^\s*>\s?/, "").trim();
}

function parseHeading(line: string): { level: number; text: string } {
  const match = /^(#{1,6})\s+(.*)$/.exec(line);
  if (!match) {
    return { level: 1, text: line.trim() };
  }
  return {
    level: match[1].length,
    text: match[2].trim(),
  };
}

export function parsePlanAnchors(markdown: string): ParsedPlanDocument {
  const { contentLines, lineOffset } = stripFrontmatter(markdown);
  const anchors: PlanDocumentAnchor[] = [];
  const counters = new Map<string, number>();
  const headingPath: string[] = [];
  const lineCount = normalizeLineEndings(markdown).split("\n").length;
  let firstTitle: string | null = null;

  const pushAnchor = (
    blockKind: PlanReviewBlockKind,
    text: string,
    startIndex: number,
    endIndex: number,
  ): void => {
    const normalized = text.trim();
    if (!normalized && blockKind !== "global") return;
    anchors.push(
      buildAnchor({
        headingPath,
        blockKind,
        blockIndexPath: nextBlockIndex(counters, headingPath),
        text: normalized,
        lineStart: startIndex + lineOffset + 1,
        lineEnd: endIndex + lineOffset + 1,
      }),
    );
  };

  let i = 0;
  while (i < contentLines.length) {
    const line = contentLines[i];

    if (isBlank(line)) {
      i += 1;
      continue;
    }

    if (isHeading(line)) {
      const heading = parseHeading(line);
      headingPath.splice(heading.level - 1);
      headingPath[heading.level - 1] = heading.text;
      if (!firstTitle) firstTitle = heading.text;
      pushAnchor("heading", heading.text, i, i);
      i += 1;
      continue;
    }

    if (isCodeFence(line)) {
      const fence = line.trim().slice(0, 3);
      const block: string[] = [line];
      const start = i;
      i += 1;
      while (i < contentLines.length) {
        block.push(contentLines[i]);
        if (contentLines[i].trim().startsWith(fence)) {
          i += 1;
          break;
        }
        i += 1;
      }
      pushAnchor("code_block", block.join("\n"), start, i - 1);
      continue;
    }

    if (isChecklistItem(line) || isListItem(line)) {
      const start = i;
      const block: string[] = [stripListMarker(line)];
      const baseIndent = line.match(/^\s*/)?.[0].length ?? 0;
      i += 1;
      while (i < contentLines.length) {
        const next = contentLines[i];
        if (isBlank(next)) break;
        if (isSpecialBlockStart(next) && (next.match(/^\s*/)?.[0].length ?? 0) <= baseIndent) {
          break;
        }
        block.push(next.trim());
        i += 1;
      }
      pushAnchor(
        isChecklistItem(line) ? "checklist_item" : "list_item",
        normalizeText(block),
        start,
        i - 1,
      );
      continue;
    }

    if (isQuote(line)) {
      const start = i;
      const block: string[] = [stripQuoteMarker(line)];
      i += 1;
      while (i < contentLines.length && isQuote(contentLines[i])) {
        block.push(stripQuoteMarker(contentLines[i]));
        i += 1;
      }
      pushAnchor("quote", normalizeText(block), start, i - 1);
      continue;
    }

    if (isTableRow(line)) {
      const start = i;
      const block: string[] = [line.trim()];
      i += 1;
      while (i < contentLines.length) {
        const next = contentLines[i];
        if (isBlank(next)) break;
        if (!isTableRow(next) && !isTableSeparator(next)) break;
        block.push(next.trim());
        i += 1;
      }
      pushAnchor("table", block.join("\n"), start, i - 1);
      continue;
    }

    const start = i;
    const block: string[] = [line.trim()];
    i += 1;
    while (i < contentLines.length) {
      const next = contentLines[i];
      if (isBlank(next) || isSpecialBlockStart(next)) break;
      block.push(next.trim());
      i += 1;
    }
    pushAnchor("paragraph", normalizeText(block), start, i - 1);
  }

  if (!firstTitle) {
    const firstAnchor = anchors.find((anchor) => anchor.blockKind !== "global");
    firstTitle = firstAnchor?.text ?? null;
  }

  return {
    anchors,
    lineCount,
    title: firstTitle,
  };
}
