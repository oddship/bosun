import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "bun:test";

import {
  createReviewRound,
  createReviewSession,
  createReviewSnapshotManifest,
  createReviewId,
} from "./session-types.ts";
import {
  ensureReviewSnapshotLayout,
  writeReviewRound,
  writeReviewSession,
  writeReviewSnapshotManifest,
  writeSnapshotFile,
  type ReviewStateOptions,
} from "./review-state.ts";
import { loadRoundFilePair } from "./git-review-data.ts";

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }

  return result.stdout.trim();
}

test("loadRoundFilePair cumulative resolves base content across rename history", () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "pi-cdp-diff-review-"));

  try {
    git(projectRoot, "init", "-q");
    git(projectRoot, "config", "user.email", "test@example.com");
    git(projectRoot, "config", "user.name", "tester");

    writeFileSync(path.join(projectRoot, "old.txt"), "old-base\n");
    writeFileSync(path.join(projectRoot, "keep.txt"), "keep-base\n");
    git(projectRoot, "add", "old.txt", "keep.txt");
    git(projectRoot, "commit", "-q", "-m", "init");

    const baseCommit = git(projectRoot, "rev-parse", "HEAD");
    const sessionId = createReviewId("session");
    const initialRoundId = createReviewId("round");
    const reroundId = createReviewId("round");
    const baselineSnapshotId = createReviewId("snapshot");
    const initialHeadSnapshotId = createReviewId("snapshot");
    const reroundBaseSnapshotId = createReviewId("snapshot");
    const reroundHeadSnapshotId = createReviewId("snapshot");
    const options: ReviewStateOptions = { projectRoot };
    const sessionDir = path.join(
      projectRoot,
      "workspace",
      "scratch",
      "diff-reviews",
      sessionId,
    );

    writeReviewSnapshotManifest(
      createReviewSnapshotManifest({
        id: baselineSnapshotId,
        sessionId,
        side: "base",
        repoRoot: projectRoot,
        sourceScope: { kind: "custom", paths: ["keep.txt"] },
        target: { kind: "commit", ref: "HEAD", resolvedRef: baseCommit },
        files: [],
      }),
      options,
    );

    const initialHeadPaths = ensureReviewSnapshotLayout(
      sessionId,
      initialHeadSnapshotId,
      options,
    );
    const keepContent = Buffer.from("keep-changed\n", "utf8");
    const keepStoragePath = writeSnapshotFile(
      initialHeadPaths.filesDir,
      "keep.txt",
      keepContent,
    );
    writeReviewSnapshotManifest(
      createReviewSnapshotManifest({
        id: initialHeadSnapshotId,
        sessionId,
        side: "head",
        repoRoot: projectRoot,
        sourceScope: { kind: "custom", paths: ["keep.txt"] },
        target: { kind: "worktree", ref: null, resolvedRef: null },
        files: [
          {
            path: "keep.txt",
            canonicalPath: "keep.txt",
            status: "modified",
            present: true,
            byteLength: keepContent.byteLength,
            sha256: sha256(keepContent),
            storagePath: keepStoragePath,
          },
        ],
      }),
      options,
    );

    writeReviewSnapshotManifest(
      createReviewSnapshotManifest({
        id: reroundBaseSnapshotId,
        sessionId,
        side: "base",
        repoRoot: projectRoot,
        sourceScope: { kind: "custom", paths: ["new.txt"] },
        target: { kind: "commit", ref: "HEAD", resolvedRef: baseCommit },
        files: [],
      }),
      options,
    );

    const reroundHeadPaths = ensureReviewSnapshotLayout(
      sessionId,
      reroundHeadSnapshotId,
      options,
    );
    const newContent = Buffer.from("old-base\nrenamed-change\n", "utf8");
    const newStoragePath = writeSnapshotFile(
      reroundHeadPaths.filesDir,
      "new.txt",
      newContent,
    );
    writeReviewSnapshotManifest(
      createReviewSnapshotManifest({
        id: reroundHeadSnapshotId,
        sessionId,
        side: "head",
        repoRoot: projectRoot,
        sourceScope: { kind: "custom", paths: ["new.txt"] },
        target: { kind: "worktree", ref: null, resolvedRef: null },
        files: [
          {
            path: "new.txt",
            canonicalPath: "new.txt",
            previousPath: "old.txt",
            status: "renamed",
            present: true,
            byteLength: newContent.byteLength,
            sha256: sha256(newContent),
            storagePath: newStoragePath,
          },
        ],
      }),
      options,
    );

    writeReviewRound(
      createReviewRound({
        id: initialRoundId,
        sessionId,
        parentRoundId: null,
        kind: "initial",
        sourceScope: { kind: "custom", paths: ["keep.txt"] },
        baseSnapshotId: baselineSnapshotId,
        headSnapshotId: initialHeadSnapshotId,
        changedFiles: ["keep.txt"],
        fileChanges: [{ path: "keep.txt", status: "modified" }],
        summary: "initial round",
        requestedBy: "tester",
      }),
      options,
    );

    writeReviewRound(
      createReviewRound({
        id: reroundId,
        sessionId,
        parentRoundId: initialRoundId,
        kind: "reround",
        sourceScope: { kind: "custom", paths: ["new.txt"] },
        baseSnapshotId: reroundBaseSnapshotId,
        headSnapshotId: reroundHeadSnapshotId,
        changedFiles: ["new.txt"],
        fileChanges: [
          {
            path: "new.txt",
            previousPath: "old.txt",
            status: "renamed",
          },
        ],
        summary: "rename reround",
        requestedBy: "tester",
      }),
      options,
    );

    writeReviewSession(
      createReviewSession({
        id: sessionId,
        repoRoot: projectRoot,
        targetAgent: "tester",
        bridgeAgent: "bridge",
        title: "rename cumulative test",
        baselineSnapshotId,
        latestRoundId: reroundId,
      }),
      options,
    );

    const pair = loadRoundFilePair({
      sessionDir,
      requestedPath: "new.txt",
      mode: "cumulative",
    });

    expect(pair.status).toBe("renamed");
    expect(pair.displayPath).toBe("old.txt → new.txt");
    expect(pair.previousPath).toBe("old.txt");
    expect(pair.originalContent).toBe("old-base\n");
    expect(pair.modifiedContent).toBe("old-base\nrenamed-change\n");
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
