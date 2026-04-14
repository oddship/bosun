import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actorStateDir, actorStateFile, partitionedStateFiles, readPartitionedJsonRecords, safeStateKey } from "./site-state";

function makeTempStateDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-gateway-site-state-"));
}

describe("site-state actor partitions", () => {
  test("maps actor ids into stable actor directories", () => {
    const root = makeTempStateDir();
    expect(safeStateKey("actor_owner")).toBe("actor-owner");
    expect(actorStateDir(root, "actor_owner")).toBe(join(root, "actors", "actor-owner"));
    expect(actorStateDir(root)).toBe(join(root, "shared"));
  });

  test("lists legacy, shared, and actor-partitioned state files", () => {
    const root = makeTempStateDir();
    mkdirSync(join(root, "shared"), { recursive: true });
    mkdirSync(join(root, "actors", "actor-owner"), { recursive: true });
    writeFileSync(join(root, "messages.json"), "[]\n", "utf-8");
    writeFileSync(join(root, "shared", "messages.json"), "[]\n", "utf-8");
    writeFileSync(join(root, "actors", "actor-owner", "messages.json"), "[]\n", "utf-8");

    expect(partitionedStateFiles(root, "messages.json")).toEqual([
      join(root, "messages.json"),
      join(root, "shared", "messages.json"),
      join(root, "actors", "actor-owner", "messages.json"),
    ]);
  });

  test("reads partitioned records and prefers actor-partitioned copies over legacy duplicates", () => {
    const root = makeTempStateDir();
    mkdirSync(join(root, "shared"), { recursive: true });
    mkdirSync(join(root, "actors", "actor-owner"), { recursive: true });

    writeFileSync(join(root, "messages.json"), `${JSON.stringify([
      { id: "msg-1", ts: "2026-04-14T10:00:00.000Z", content: "legacy" },
    ], null, 2)}\n`, "utf-8");
    writeFileSync(join(root, "shared", "messages.json"), `${JSON.stringify([
      { id: "msg-2", ts: "2026-04-14T10:01:00.000Z", content: "shared" },
    ], null, 2)}\n`, "utf-8");
    writeFileSync(actorStateFile(root, "actor_owner", "messages.json"), `${JSON.stringify([
      { id: "msg-1", ts: "2026-04-14T10:02:00.000Z", content: "actor copy" },
      { id: "msg-3", ts: "2026-04-14T10:03:00.000Z", content: "actor only" },
    ], null, 2)}\n`, "utf-8");

    expect(readPartitionedJsonRecords<{ id: string; ts: string; content: string }>(root, "messages.json")).toEqual([
      { id: "msg-2", ts: "2026-04-14T10:01:00.000Z", content: "shared" },
      { id: "msg-1", ts: "2026-04-14T10:02:00.000Z", content: "actor copy" },
      { id: "msg-3", ts: "2026-04-14T10:03:00.000Z", content: "actor only" },
    ]);
  });
});
