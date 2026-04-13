import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import {
  createReviewId,
  createReviewRound,
  createReviewSnapshotManifest,
  type ReviewFileChange,
  type ReviewFileChangeStatus,
  type ReviewRound,
  type ReviewRoundKind,
  type ReviewSnapshotManifest,
  type ReviewSnapshotSide,
  type ReviewSnapshotTarget,
  type ReviewSourceScope,
} from "./session-types";
import {
  ensureReviewSessionLayout,
  ensureReviewSnapshotLayout,
  getReviewSnapshotPaths,
  loadSession,
  readReviewSnapshotManifest,
  readSnapshotFile,
  resolveSessionDir,
  writeReviewRound,
  writeReviewSnapshotManifest,
  writeSnapshotFile,
  type ReviewRoundViewMode,
  type ReviewStateOptions,
} from "./review-state";

export interface GitCommandResult {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
}

export interface ResolvedDiffScope {
  scope: ReviewSourceScope;
  paths: string[];
  useCached: boolean;
  includeUntracked: boolean;
  refArgs: string[];
  baseTarget: ReviewSnapshotTarget;
  headTarget: ReviewSnapshotTarget;
}

export interface MaterializeSnapshotInput {
  sessionId: string;
  repoRoot: string;
  snapshotId?: string;
  side: ReviewSnapshotSide;
  sourceScope: ReviewSourceScope;
  target: ReviewSnapshotTarget;
  fileChanges: ReviewFileChange[];
  state?: ReviewStateOptions;
}

export interface BuildGitReviewRoundInput {
  sessionId: string;
  repoRoot: string;
  scope: ReviewSourceScope;
  summary: string;
  requestedBy: string;
  parentRoundId?: string | null;
  kind?: ReviewRoundKind;
  affectedThreadIds?: string[];
  contextLines?: number;
  state?: ReviewStateOptions;
}

export interface BuildGitReviewRoundResult {
  resolvedScope: ResolvedDiffScope;
  fileChanges: ReviewFileChange[];
  baseSnapshot: ReviewSnapshotManifest;
  headSnapshot: ReviewSnapshotManifest;
  round: ReviewRound;
  unifiedDiff: string;
  unifiedDiffPath: string;
}

export interface PersistGitReviewRoundResult extends BuildGitReviewRoundResult {
  roundPath: string;
}

export interface CollectInitialDiffScopeInput
  extends Omit<BuildGitReviewRoundInput, "kind" | "parentRoundId"> {
  kind?: never;
  parentRoundId?: never;
}

export interface RoundFilePair {
  path: string;
  displayPath: string;
  status: ReviewFileChangeStatus | "missing";
  previousPath?: string;
  originalContent: string;
  modifiedContent: string;
  language: string;
  hint: string;
}

export interface LoadRoundFilePairInput {
  sessionDir: string;
  requestedPath: string;
  mode?: ReviewRoundViewMode;
  roundId?: string;
}

function normalizeRepoPath(filePath: string): string {
  const normalized = path.posix.normalize(filePath.replace(/\\/g, "/"));
  if (!normalized || normalized === ".") {
    throw new Error(`Invalid repository-relative path: ${filePath}`);
  }
  if (path.posix.isAbsolute(normalized)) {
    throw new Error(`Absolute paths are not allowed: ${filePath}`);
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Path escapes repository root: ${filePath}`);
  }
  return normalized;
}

function normalizePaths(paths: string[] | undefined): string[] {
  if (!paths) return [];
  return [...new Set(paths.map(normalizeRepoPath))];
}

function appendPathspec(args: string[], paths: string[]): void {
  if (paths.length === 0) return;
  args.push("--", ...paths);
}

function decode(output: Buffer): string {
  return output.toString("utf8");
}

function runGit(
  repoRoot: string,
  args: string[],
  allowFailure = false
): GitCommandResult {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }

  const exitCode = result.status ?? 1;
  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr = result.stderr ?? Buffer.alloc(0);

  if (!allowFailure && exitCode !== 0) {
    const rendered = decode(stderr).trim();
    throw new Error(`git ${args.join(" ")} failed (${exitCode}): ${rendered}`);
  }

  return { exitCode, stdout, stderr };
}

function runGitText(repoRoot: string, args: string[], allowFailure = false): string {
  return decode(runGit(repoRoot, args, allowFailure).stdout);
}

function toDiffStatus(code: string): ReviewFileChangeStatus {
  const short = code.charAt(0);
  switch (short) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    default:
      return "unknown";
  }
}

function parseNameStatusZ(payload: string): ReviewFileChange[] {
  const tokens = payload.split("\0");
  const changes: ReviewFileChange[] = [];

  let index = 0;
  while (index < tokens.length) {
    const statusToken = tokens[index++] ?? "";
    if (!statusToken) break;

    const status = toDiffStatus(statusToken);

    if (status === "renamed" || status === "copied") {
      const previousPath = tokens[index++] ?? "";
      const nextPath = tokens[index++] ?? "";
      if (!previousPath || !nextPath) continue;
      changes.push({
        path: normalizeRepoPath(nextPath),
        previousPath: normalizeRepoPath(previousPath),
        status,
      });
      continue;
    }

    const filePath = tokens[index++] ?? "";
    if (!filePath) continue;
    changes.push({
      path: normalizeRepoPath(filePath),
      status,
    });
  }

  return changes;
}

function dedupeChanges(changes: ReviewFileChange[]): ReviewFileChange[] {
  const seen = new Set<string>();
  const deduped: ReviewFileChange[] = [];

  for (const change of changes) {
    const key = `${change.status}|${change.previousPath ?? ""}|${change.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(change);
  }

  return deduped;
}

function listUntrackedFiles(repoRoot: string, paths: string[]): string[] {
  const args = ["ls-files", "--others", "--exclude-standard", "-z"];
  appendPathspec(args, paths);
  const output = runGitText(repoRoot, args);
  return output
    .split("\0")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(normalizeRepoPath);
}

function buildNameStatusArgs(scope: ResolvedDiffScope): string[] {
  const args = ["diff", "--name-status", "-z", "--find-renames=90%"];
  if (scope.useCached) args.push("--cached");
  args.push(...scope.refArgs);
  appendPathspec(args, scope.paths);
  return args;
}

function buildPatchArgs(scope: ResolvedDiffScope, contextLines: number): string[] {
  const args = [
    "diff",
    "--patch",
    "--find-renames=90%",
    `--unified=${contextLines}`,
  ];
  if (scope.useCached) args.push("--cached");
  args.push(...scope.refArgs);
  appendPathspec(args, scope.paths);
  return args;
}

function resolveCommitRef(repoRoot: string, ref: string): string {
  const result = runGit(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`], true);
  if (result.exitCode !== 0) {
    const message = decode(result.stderr).trim();
    throw new Error(
      `Unable to resolve commit ref '${ref}' for diff-review scope${
        message ? `: ${message}` : ""
      }`
    );
  }
  return decode(result.stdout).trim();
}

function resolveSnapshotTarget(
  repoRoot: string,
  target: ReviewSnapshotTarget
): ReviewSnapshotTarget {
  if (target.kind !== "commit" || !target.ref) {
    return { ...target, resolvedRef: null };
  }

  return {
    ...target,
    resolvedRef: resolveCommitRef(repoRoot, target.ref),
  };
}

function validateResolvedScopeRefs(
  repoRoot: string,
  scope: ResolvedDiffScope
): void {
  for (const target of [scope.baseTarget, scope.headTarget]) {
    if (target.kind === "commit" && target.ref) {
      resolveCommitRef(repoRoot, target.ref);
    }
  }
}

function pickPathForSide(change: ReviewFileChange, side: ReviewSnapshotSide): string {
  if (
    side === "base" &&
    (change.status === "renamed" || change.status === "copied") &&
    change.previousPath
  ) {
    return change.previousPath;
  }

  return change.path;
}

function isPresentOnSide(
  change: ReviewFileChange,
  side: ReviewSnapshotSide
): boolean {
  if (change.status === "added") return side === "head";
  if (change.status === "deleted") return side === "base";
  return true;
}

function readFromTarget(
  repoRoot: string,
  target: ReviewSnapshotTarget,
  filePath: string
): Buffer | null {
  const normalizedPath = normalizeRepoPath(filePath);

  if (target.kind === "worktree") {
    const fullPath = path.join(repoRoot, normalizedPath);
    if (!fs.existsSync(fullPath)) return null;
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return null;
    return fs.readFileSync(fullPath);
  }

  if (target.kind === "index") {
    const response = runGit(repoRoot, ["show", `:${normalizedPath}`], true);
    if (response.exitCode !== 0) return null;
    return response.stdout;
  }

  if (!target.ref) return null;
  const response = runGit(repoRoot, ["show", `${target.ref}:${normalizedPath}`], true);
  if (response.exitCode !== 0) return null;
  return response.stdout;
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function ensureGitRepository(repoRoot: string): void {
  const output = runGitText(repoRoot, ["rev-parse", "--is-inside-work-tree"])
    .trim()
    .toLowerCase();

  if (output !== "true") {
    throw new Error(`Not a git repository: ${repoRoot}`);
  }
}

export function resolveDiffScope(scope: ReviewSourceScope): ResolvedDiffScope {
  const paths = normalizePaths(scope.paths);

  switch (scope.kind) {
    case "worktree":
      return {
        scope,
        paths,
        useCached: false,
        includeUntracked: true,
        refArgs: ["HEAD"],
        baseTarget: { kind: "commit", ref: "HEAD", resolvedRef: null },
        headTarget: { kind: "worktree", ref: null, resolvedRef: null },
      };

    case "staged":
      return {
        scope,
        paths,
        useCached: true,
        includeUntracked: false,
        refArgs: [],
        baseTarget: { kind: "commit", ref: "HEAD", resolvedRef: null },
        headTarget: { kind: "index", ref: null, resolvedRef: null },
      };

    case "last-commit":
      return {
        scope,
        paths,
        useCached: false,
        includeUntracked: false,
        refArgs: ["HEAD~1", "HEAD"],
        baseTarget: { kind: "commit", ref: "HEAD~1", resolvedRef: null },
        headTarget: { kind: "commit", ref: "HEAD", resolvedRef: null },
      };

    case "commit-range": {
      if (!scope.baseRef || !scope.headRef) {
        throw new Error("commit-range scope requires both baseRef and headRef");
      }

      return {
        scope,
        paths,
        useCached: false,
        includeUntracked: false,
        refArgs: [scope.baseRef, scope.headRef],
        baseTarget: { kind: "commit", ref: scope.baseRef, resolvedRef: null },
        headTarget: { kind: "commit", ref: scope.headRef, resolvedRef: null },
      };
    }

    case "custom": {
      const baseRef = scope.baseRef ?? "HEAD";
      if (scope.headRef) {
        return {
          scope,
          paths,
          useCached: false,
          includeUntracked: false,
          refArgs: [baseRef, scope.headRef],
          baseTarget: { kind: "commit", ref: baseRef, resolvedRef: null },
          headTarget: { kind: "commit", ref: scope.headRef, resolvedRef: null },
        };
      }

      return {
        scope,
        paths,
        useCached: false,
        includeUntracked: true,
        refArgs: [baseRef],
        baseTarget: { kind: "commit", ref: baseRef, resolvedRef: null },
        headTarget: { kind: "worktree", ref: null, resolvedRef: null },
      };
    }
  }
}

export function collectDiffFileChanges(
  repoRoot: string,
  scope: ReviewSourceScope
): ReviewFileChange[] {
  ensureGitRepository(repoRoot);
  const resolved = resolveDiffScope(scope);
  validateResolvedScopeRefs(repoRoot, resolved);

  const diffOutput = runGitText(repoRoot, buildNameStatusArgs(resolved));
  const changes = parseNameStatusZ(diffOutput);

  if (resolved.includeUntracked) {
    const alreadyTracked = new Set(changes.map((change) => change.path));
    for (const filePath of listUntrackedFiles(repoRoot, resolved.paths)) {
      if (alreadyTracked.has(filePath)) continue;
      changes.push({ path: filePath, status: "added" });
    }
  }

  return dedupeChanges(changes);
}

export function collectUnifiedDiff(
  repoRoot: string,
  scope: ReviewSourceScope,
  contextLines = 3
): string {
  ensureGitRepository(repoRoot);
  const resolved = resolveDiffScope(scope);
  validateResolvedScopeRefs(repoRoot, resolved);

  const chunks: string[] = [];
  const basePatch = runGitText(repoRoot, buildPatchArgs(resolved, contextLines));
  if (basePatch.trim().length > 0) chunks.push(basePatch.trimEnd());

  if (resolved.includeUntracked) {
    for (const filePath of listUntrackedFiles(repoRoot, resolved.paths)) {
      const patch = runGitText(
        repoRoot,
        ["diff", "--patch", "--no-index", "--", "/dev/null", filePath],
        true
      );
      if (patch.trim().length > 0) {
        chunks.push(patch.trimEnd());
      }
    }
  }

  if (chunks.length === 0) return "";
  return `${chunks.join("\n\n")}\n`;
}

export function materializeSnapshotFromFileChanges(
  input: MaterializeSnapshotInput
): ReviewSnapshotManifest {
  ensureGitRepository(input.repoRoot);

  const target = resolveSnapshotTarget(input.repoRoot, input.target);
  const snapshotId = input.snapshotId ?? createReviewId("snapshot");
  const snapshotPaths = ensureReviewSnapshotLayout(
    input.sessionId,
    snapshotId,
    input.state
  );

  const files = input.fileChanges.map((change) => {
    const canonicalPath = normalizeRepoPath(change.path);
    const snapshotPath = normalizeRepoPath(pickPathForSide(change, input.side));
    const present = isPresentOnSide(change, input.side);

    if (!present) {
      return {
        path: snapshotPath,
        canonicalPath,
        status: change.status,
        previousPath: change.previousPath,
        present: false,
        byteLength: 0,
        sha256: null,
        storagePath: null,
      };
    }

    const content = readFromTarget(input.repoRoot, target, snapshotPath);
    if (!content) {
      return {
        path: snapshotPath,
        canonicalPath,
        status: change.status,
        previousPath: change.previousPath,
        present: false,
        byteLength: 0,
        sha256: null,
        storagePath: null,
      };
    }

    const storagePath = writeSnapshotFile(snapshotPaths.filesDir, snapshotPath, content);

    return {
      path: snapshotPath,
      canonicalPath,
      status: change.status,
      previousPath: change.previousPath,
      present: true,
      byteLength: content.byteLength,
      sha256: sha256(content),
      storagePath,
    };
  });

  const manifest = createReviewSnapshotManifest({
    id: snapshotId,
    sessionId: input.sessionId,
    side: input.side,
    repoRoot: input.repoRoot,
    sourceScope: input.sourceScope,
    target,
    files,
  });

  writeReviewSnapshotManifest(manifest, input.state);
  return manifest;
}

function chooseRoundKind(
  inputKind: ReviewRoundKind | undefined,
  parentRoundId: string | null | undefined
): ReviewRoundKind {
  if (inputKind) return inputKind;
  return parentRoundId ? "reround" : "initial";
}

export function buildGitReviewRoundData(
  input: BuildGitReviewRoundInput
): BuildGitReviewRoundResult {
  ensureGitRepository(input.repoRoot);
  const sessionPaths = ensureReviewSessionLayout(input.sessionId, input.state);
  const resolvedScope = resolveDiffScope(input.scope);
  const fileChanges = collectDiffFileChanges(input.repoRoot, input.scope);

  const baseSnapshot = materializeSnapshotFromFileChanges({
    sessionId: input.sessionId,
    repoRoot: input.repoRoot,
    side: "base",
    sourceScope: input.scope,
    target: resolvedScope.baseTarget,
    fileChanges,
    state: input.state,
  });

  const headSnapshot = materializeSnapshotFromFileChanges({
    sessionId: input.sessionId,
    repoRoot: input.repoRoot,
    side: "head",
    sourceScope: input.scope,
    target: resolvedScope.headTarget,
    fileChanges,
    state: input.state,
  });

  const round = createReviewRound({
    sessionId: input.sessionId,
    parentRoundId: input.parentRoundId ?? null,
    kind: chooseRoundKind(input.kind, input.parentRoundId),
    sourceScope: {
      ...input.scope,
      paths: resolvedScope.paths.length > 0 ? resolvedScope.paths : undefined,
    },
    baseSnapshotId: baseSnapshot.id,
    headSnapshotId: headSnapshot.id,
    changedFiles: fileChanges.map((change) => change.path),
    fileChanges,
    affectedThreadIds: input.affectedThreadIds ?? [],
    summary: input.summary,
    requestedBy: input.requestedBy,
  });

  const unifiedDiff = collectUnifiedDiff(
    input.repoRoot,
    input.scope,
    input.contextLines ?? 3
  );

  const unifiedDiffPath = path.join(sessionPaths.roundDiffsDir, `${round.id}.patch`);
  fs.writeFileSync(unifiedDiffPath, unifiedDiff, "utf8");

  return {
    resolvedScope,
    fileChanges,
    baseSnapshot,
    headSnapshot,
    round,
    unifiedDiff,
    unifiedDiffPath,
  };
}

export function persistGitReviewRoundData(
  input: BuildGitReviewRoundInput
): PersistGitReviewRoundResult {
  const built = buildGitReviewRoundData(input);
  const roundPath = writeReviewRound(built.round, input.state);
  return {
    ...built,
    roundPath,
  };
}

export function collectInitialDiffScope(
  input: CollectInitialDiffScopeInput
): PersistGitReviewRoundResult {
  return persistGitReviewRoundData({
    ...input,
    kind: "initial",
    parentRoundId: null,
  });
}

function isBinaryBuffer(content: Buffer): boolean {
  const limit = Math.min(content.length, 8000);
  for (let index = 0; index < limit; index += 1) {
    if (content[index] === 0) return true;
  }
  return false;
}

function decodeSnapshotContent(content: Buffer): string {
  if (isBinaryBuffer(content)) return "";
  return content.toString("utf8");
}

function inferLanguage(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return "javascript";
  }
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".sh")) return "shell";
  return "plaintext";
}

function roundHint(mode: ReviewRoundViewMode): string {
  if (mode === "delta") return "Delta since the previous published round.";
  if (mode === "cumulative") {
    return "Cumulative diff since the session baseline.";
  }
  return "Initial diff for this review session.";
}

function pickLatestRound(
  rounds: ReviewRound[],
  latestRoundId: string | null,
  explicitRoundId?: string
): ReviewRound | null {
  if (rounds.length === 0) return null;

  if (explicitRoundId) {
    const explicit = rounds.find((round) => round.id === explicitRoundId);
    if (explicit) return explicit;
  }

  if (latestRoundId) {
    const latest = rounds.find((round) => round.id === latestRoundId);
    if (latest) return latest;
  }

  return rounds[rounds.length - 1] ?? null;
}

function pickInitialRound(rounds: ReviewRound[]): ReviewRound | null {
  return rounds.find((round) => round.kind === "initial") ?? rounds[0] ?? null;
}

function findRoundFileChange(
  round: ReviewRound,
  requestedPath: string
): ReviewFileChange | null {
  const normalize = (value: string): string => value.replace(/\\/g, "/");
  const expected = normalize(requestedPath);

  for (const change of round.fileChanges) {
    if (normalize(change.path) === expected) return change;
    if (change.previousPath && normalize(change.previousPath) === expected) {
      return change;
    }
  }

  return null;
}

function findFileChange(
  rounds: ReviewRound[],
  mode: ReviewRoundViewMode,
  sourceRound: ReviewRound,
  requestedPath: string
): ReviewFileChange | null {
  if (mode !== "cumulative") {
    return findRoundFileChange(sourceRound, requestedPath);
  }

  const sourceRoundIndex = rounds.findIndex((round) => round.id === sourceRound.id);
  const startIndex = sourceRoundIndex >= 0 ? sourceRoundIndex : rounds.length - 1;

  for (let index = startIndex; index >= 0; index -= 1) {
    const found = findRoundFileChange(rounds[index], requestedPath);
    if (found) return found;
  }

  return null;
}

function findLatestRoundForPath(
  rounds: ReviewRound[],
  requestedPath: string,
  fallback: ReviewRound
): ReviewRound {
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    if (findRoundFileChange(rounds[index], requestedPath)) {
      return rounds[index];
    }
  }
  return fallback;
}

function readSnapshotText(
  sessionId: string,
  snapshotId: string,
  requestedPath: string,
  options: ReviewStateOptions
): string {
  const manifest = readReviewSnapshotManifest(sessionId, snapshotId, options);
  const entry = manifest.files.find(
    (file) =>
      file.canonicalPath === requestedPath ||
      file.path === requestedPath ||
      file.previousPath === requestedPath
  );

  if (!entry || !entry.present) return "";

  const paths = getReviewSnapshotPaths(sessionId, snapshotId, options);
  const relativePath = entry.storagePath ?? entry.path;
  if (!relativePath) return "";

  const raw = readSnapshotFile(paths.filesDir, relativePath);
  return decodeSnapshotContent(raw);
}

export function loadRoundFilePair(input: LoadRoundFilePairInput): RoundFilePair {
  const mode = input.mode ?? "delta";
  const requestedPath = normalizeRepoPath(input.requestedPath);
  const sessionDir = resolveSessionDir(input.sessionDir);
  const loaded = loadSession(sessionDir);
  const rounds = [...loaded.rounds].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latestRound = pickLatestRound(
    rounds,
    loaded.session.latestRoundId,
    input.roundId
  );

  if (!latestRound) {
    return {
      path: requestedPath,
      displayPath: requestedPath,
      status: "missing",
      originalContent: "",
      modifiedContent: "",
      language: inferLanguage(requestedPath),
      hint: "No rounds are available for this session.",
    };
  }

  const initialRound = pickInitialRound(rounds) ?? latestRound;
  const latestTouchedRound =
    mode === "cumulative"
      ? findLatestRoundForPath(rounds, requestedPath, latestRound)
      : latestRound;
  const sourceRound = mode === "initial" ? initialRound : latestTouchedRound;

  const baseSnapshotId =
    mode === "cumulative"
      ? loaded.session.baselineSnapshotId
      : sourceRound.baseSnapshotId;
  const headSnapshotId = sourceRound.headSnapshotId;

  const sessionOptions: ReviewStateOptions = {
    reviewRoot: loaded.paths.reviewRoot,
  };

  const fileChange = findFileChange(rounds, mode, sourceRound, requestedPath);
  const canonicalPath = fileChange?.path ?? requestedPath;
  const previousPath = fileChange?.previousPath;

  const originalContent = readSnapshotText(
    loaded.session.id,
    baseSnapshotId,
    canonicalPath,
    sessionOptions
  );
  const modifiedContent = readSnapshotText(
    loaded.session.id,
    headSnapshotId,
    canonicalPath,
    sessionOptions
  );

  const displayPath =
    previousPath && previousPath !== canonicalPath
      ? `${previousPath} → ${canonicalPath}`
      : canonicalPath;

  return {
    path: canonicalPath,
    displayPath,
    status: fileChange?.status ?? "unknown",
    previousPath,
    originalContent,
    modifiedContent,
    language: inferLanguage(canonicalPath),
    hint: roundHint(mode),
  };
}
