import { describe, test, expect, beforeEach } from "bun:test";
import {
  buildCachedPrefix,
  buildPhasePrompt,
  buildForceDonePrompt,
  extractToolCalls,
  extractDoneCall,
  hasToolCallsWithDone,
  diffState,
  validatePlanFromState,
} from "../src/protocol.js";
import {
  mockTextResponse,
  mockToolCallResponse,
  mockDoneResponse,
  mockDoneWithToolsResponse,
  resetIdCounter,
} from "./helpers.js";

beforeEach(() => resetIdCounter());

describe("buildCachedPrefix", () => {
  test("includes system prompt, instructions, and plan", () => {
    const prefix = buildCachedPrefix("You are X.", [
      { description: "Read files", tools: ["read", "grep"] },
      { description: "Write fix", tools: ["edit"] },
    ]);

    expect(prefix).toContain("You are X.");
    expect(prefix).toContain("Execute only the current phase");
    expect(prefix).toContain("Phase 1: Read files [tools: read, grep]");
    expect(prefix).toContain("Phase 2: Write fix [tools: edit]");
  });
});

describe("buildPhasePrompt", () => {
  test("includes state and phase marker", () => {
    const prompt = buildPhasePrompt(
      { bug: { file: "auth.ts", line: 42 } },
      { description: "Fix the bug", tools: ["edit"] },
      1,
      3,
    );

    expect(prompt).toContain('"bug"');
    expect(prompt).toContain("auth.ts");
    expect(prompt).toContain("Phase 2 of 3: Fix the bug");
  });

  test("handles empty state", () => {
    const prompt = buildPhasePrompt(
      {},
      { description: "Start", tools: ["read"] },
      0,
      1,
    );

    expect(prompt).toContain("{}");
    expect(prompt).toContain("Phase 1 of 1: Start");
  });
});

describe("buildForceDonePrompt", () => {
  test("includes state and instruction", () => {
    const prompt = buildForceDonePrompt({ partial: true });
    expect(prompt).toContain("Phase budget exceeded");
    expect(prompt).toContain("done()");
    expect(prompt).toContain('"partial": true');
  });
});

describe("extractToolCalls", () => {
  test("extracts tool calls from response", () => {
    const response = mockToolCallResponse(
      { name: "read", args: { path: "auth.ts" } },
      { name: "grep", args: { pattern: "null" } },
    );
    const calls = extractToolCalls(response);
    expect(calls).toHaveLength(2);
    expect(calls[0].name).toBe("read");
    expect(calls[1].name).toBe("grep");
  });

  test("returns empty for text-only response", () => {
    const response = mockTextResponse("Hello world");
    expect(extractToolCalls(response)).toHaveLength(0);
  });
});

describe("extractDoneCall", () => {
  test("extracts done() call", () => {
    const response = mockDoneResponse(
      { bug: { fixed: true } },
      "Fixed the bug",
    );
    const done = extractDoneCall(response);
    expect(done).not.toBeNull();
    expect(done!.state).toEqual({ bug: { fixed: true } });
    expect(done!.summary).toBe("Fixed the bug");
  });

  test("extracts done() with result", () => {
    const response = mockDoneResponse(
      { complete: true },
      "All done",
      { output: "success" },
    );
    const done = extractDoneCall(response);
    expect(done!.result).toEqual({ output: "success" });
  });

  test("returns null for non-done tool calls", () => {
    const response = mockToolCallResponse(
      { name: "read", args: { path: "a.ts" } },
    );
    expect(extractDoneCall(response)).toBeNull();
  });

  test("returns null for text-only response", () => {
    expect(extractDoneCall(mockTextResponse("hello"))).toBeNull();
  });
});

describe("hasToolCallsWithDone", () => {
  test("true when done + other tools", () => {
    const response = mockDoneWithToolsResponse(
      { x: 1 },
      "done",
      { name: "read", args: { path: "a.ts" } },
    );
    expect(hasToolCallsWithDone(response)).toBe(true);
  });

  test("false when only done", () => {
    const response = mockDoneResponse({ x: 1 }, "done");
    expect(hasToolCallsWithDone(response)).toBe(false);
  });

  test("false when no done", () => {
    const response = mockToolCallResponse({ name: "read", args: {} });
    expect(hasToolCallsWithDone(response)).toBe(false);
  });
});

describe("diffState", () => {
  test("detects added keys", () => {
    const diff = diffState({}, { a: 1, b: 2 });
    expect(diff.added).toEqual(["a", "b"]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  test("detects removed keys", () => {
    const diff = diffState({ a: 1, b: 2 }, {});
    expect(diff.removed).toEqual(["a", "b"]);
  });

  test("detects changed keys", () => {
    const diff = diffState({ a: 1, b: "old" }, { a: 2, b: "new" });
    expect(diff.changed).toEqual(["a", "b"]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  test("handles mixed changes", () => {
    const diff = diffState(
      { keep: 1, change: "old", remove: true },
      { keep: 1, change: "new", add: "hello" },
    );
    expect(diff.added).toEqual(["add"]);
    expect(diff.removed).toEqual(["remove"]);
    expect(diff.changed).toEqual(["change"]);
  });
});

describe("validatePlanFromState", () => {
  test("validates valid plan", () => {
    const plan = validatePlanFromState({
      plan: [
        { description: "Read", tools: ["read"] },
        { description: "Write", tools: ["edit", "write"] },
      ],
    });
    expect(plan).toHaveLength(2);
    expect(plan[0].description).toBe("Read");
  });

  test("throws for missing plan", () => {
    expect(() => validatePlanFromState({})).toThrow("non-empty array");
  });

  test("throws for empty plan", () => {
    expect(() => validatePlanFromState({ plan: [] })).toThrow("non-empty array");
  });

  test("throws for invalid phase", () => {
    expect(() =>
      validatePlanFromState({ plan: [{ tools: ["read"] }] }),
    ).toThrow("missing description");
  });

  test("throws for missing tools", () => {
    expect(() =>
      validatePlanFromState({ plan: [{ description: "Read" }] }),
    ).toThrow("missing tools array");
  });
});
