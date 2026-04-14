import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { expect, test } from "bun:test";

import {
  createInitialSession,
  loadSession,
  persistDraftState,
  persistSubmission,
  publishReround,
} from "./review-state.ts";

function makeTempProject(): string {
  return mkdtempSync(path.join(tmpdir(), "pi-plan-review-"));
}

function writePlan(projectRoot: string, relativePath: string, markdown: string): string {
  const absolutePath = path.join(projectRoot, relativePath);
  writeFileSync(absolutePath, markdown, "utf8");
  return absolutePath;
}

function cleanupProject(projectRoot: string): void {
  rmSync(projectRoot, { recursive: true, force: true });
}

test("persistSubmission clears persisted draft state after submission", () => {
  const projectRoot = makeTempProject();

  try {
    writePlan(
      projectRoot,
      "plan.md",
      `# Draft State Test\n\n## Phase 1\n- add draft persistence\n`,
    );

    const created = createInitialSession({
      sessionId: "draft-state-test",
      planFilePath: "plan.md",
      targetAgent: "tester",
      bridgeAgent: "bridge",
      projectRoot,
    });

    const loaded = loadSession(created.sessionDir, { projectRoot });
    const anchor = loaded.document.anchors.find((item) => item.blockKind === "list_item");
    expect(anchor).toBeTruthy();

    persistDraftState(
      {
        sessionDir: created.sessionDir,
        drafts: [
          {
            anchor: anchor!,
            comment: "persist this draft",
            suggestion: "persisted suggestion",
          },
        ],
        globalComment: "overall draft note",
      },
      { projectRoot },
    );

    const withDrafts = loadSession(created.sessionDir, { projectRoot });
    expect(withDrafts.draftState.drafts).toHaveLength(1);
    expect(withDrafts.draftState.globalComment).toBe("overall draft note");

    const result = persistSubmission(
      {
        sessionDir: created.sessionDir,
        outcome: "request_changes",
        actor: "bridge",
        targetAgent: "tester",
        summary: "submit drafts",
        feedback: withDrafts.draftState.drafts.map((draft) => ({
          anchor: draft.anchor,
          comment: draft.comment,
          suggestion: draft.suggestion,
          threadId: draft.threadId,
        })),
      },
      { projectRoot },
    );

    const afterSubmit = loadSession(created.sessionDir, { projectRoot });
    expect(afterSubmit.session.latestSubmissionId).toBe(result.submission.id);
    expect(afterSubmit.draftState.drafts).toHaveLength(0);
    expect(afterSubmit.draftState.globalComment).toBeNull();
  } finally {
    cleanupProject(projectRoot);
  }
});

test("publishReround preserves nested anchors across title churn and marks stale title threads", () => {
  const projectRoot = makeTempProject();

  try {
    const planPath = writePlan(
      projectRoot,
      "plan.md",
      [
        "# Original Plan Title",
        "",
        "## Phase 1",
        "- Keep this nested task stable.",
        "",
        "## Rollback",
        "- Keep rollback note.",
        "",
      ].join("\n"),
    );

    const created = createInitialSession({
      sessionId: "reround-test",
      planFilePath: "plan.md",
      targetAgent: "tester",
      bridgeAgent: "bridge",
      projectRoot,
    });

    const loaded = loadSession(created.sessionDir, { projectRoot });
    const titleAnchor = loaded.document.anchors.find(
      (item) => item.blockKind === "heading" && item.headingPath.length === 1,
    );
    const nestedAnchor = loaded.document.anchors.find(
      (item) => item.blockKind === "list_item" && item.headingPath.includes("Phase 1"),
    );
    expect(titleAnchor).toBeTruthy();
    expect(nestedAnchor).toBeTruthy();

    const submission = persistSubmission(
      {
        sessionDir: created.sessionDir,
        outcome: "request_changes",
        actor: "bridge",
        targetAgent: "tester",
        summary: "seed threads",
        feedback: [
          {
            anchor: titleAnchor!,
            comment: "title feedback",
          },
          {
            anchor: nestedAnchor!,
            comment: "nested feedback",
          },
        ],
      },
      { projectRoot },
    );

    writeFileSync(
      planPath,
      [
        "# Updated Browser Plan Title",
        "",
        "## Phase 1",
        "- Keep this nested task stable.",
        "- Add one more reround-only task.",
        "",
        "## Rollback",
        "- Keep rollback note.",
        "",
      ].join("\n"),
      "utf8",
    );

    const reround = publishReround({
      sessionDir: created.sessionDir,
      actor: "bridge",
      projectRoot,
      summary: "reround after title change",
    });

    expect(reround.document.snapshots).toHaveLength(2);
    expect(reround.diff.deltaAnchorIds.length).toBeGreaterThan(0);
    expect(reround.diff.deltaAnchorIds.length).toBeLessThan(10);

    const titleThread = reround.updatedThreads.find(
      (thread) => thread.id === submission.createdThreads[0].id,
    );
    const nestedThread = reround.updatedThreads.find(
      (thread) => thread.id === submission.createdThreads[1].id,
    );

    expect(titleThread?.stale).toBe(true);
    expect(nestedThread?.stale).toBe(false);
  } finally {
    cleanupProject(projectRoot);
  }
});
