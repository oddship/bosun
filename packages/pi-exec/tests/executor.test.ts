import { describe, test, expect, beforeEach } from "bun:test";
import { createExecutor } from "../src/executor.js";
import type { LLMCaller } from "../src/phase.js";
import type { ExecutorOptions } from "../src/executor.js";
import type { PhaseEvent } from "../src/types.js";
import {
  MockLLM,
  mockDoneResponse,
  mockToolCallResponse,
  createMockTool,
  resetIdCounter,
} from "./helpers.js";

const fakeModel = { id: "test", api: "test", provider: "test" } as any;

function createMockCaller(mockLLM: MockLLM): LLMCaller {
  return {
    async call(model, context, options) {
      return mockLLM.next(context, options);
    },
  };
}

beforeEach(() => resetIdCounter());

describe("createExecutor", () => {
  test("executes a 2-phase plan", async () => {
    const readTool = createMockTool("read");
    const editTool = createMockTool("edit");
    const llm = new MockLLM();

    // Phase 1: read → done
    llm.enqueue(
      mockToolCallResponse({ name: "read", args: { path: "auth.ts" } }),
    );
    llm.enqueue(
      mockDoneResponse({ bug: { line: 42 } }, "Found the bug"),
    );

    // Phase 2: edit → done
    llm.enqueue(
      mockToolCallResponse({ name: "edit", args: { path: "auth.ts", content: "fixed" } }),
    );
    llm.enqueue(
      mockDoneResponse(
        { bug: { line: 42 }, fix: { applied: true } },
        "Applied fix",
        { success: true },
      ),
    );

    const events: PhaseEvent[] = [];
    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "You are X.",
      tools: { read: readTool, edit: editTool },
      onPhase: (e) => events.push(e),
      llmCaller: createMockCaller(llm),
    }).run({
      plan: [
        { description: "Find the bug", tools: ["read"] },
        { description: "Fix the bug", tools: ["edit"] },
      ],
      initialState: {},
    });

    expect(result.status).toBe("completed");
    expect(result.state.fix).toEqual({ applied: true });
    expect(result.output).toEqual({ success: true });
    expect(result.phaseSummaries).toHaveLength(2);
    expect(result.metrics.phases).toHaveLength(2);

    // Check phase_end events were emitted
    const phaseEnds = events.filter((e) => e.type === "phase_end");
    expect(phaseEnds).toHaveLength(2);
  });

  test("validates tool references before execution", async () => {
    const llm = new MockLLM();

    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: { read: createMockTool("read") },
      llmCaller: createMockCaller(llm),
    }).run({
      plan: [
        { description: "Bad phase", tools: ["read", "nonexistent_tool"] },
      ],
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("nonexistent_tool");
    expect(llm.callCount).toBe(0); // No LLM calls were made
  });

  test("cost limit stops between phases", async () => {
    const readTool = createMockTool("read");
    const llm = new MockLLM();

    // Phase 1: done (costs ~0.003 per mock response × 1 call)
    llm.enqueue(mockDoneResponse({ step1: true }, "Done phase 1"));

    // Phase 2 should not execute (cost limit hit)

    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: { read: readTool },
      maxCostUsd: 0.002, // Very low — will be exceeded after phase 1
      llmCaller: createMockCaller(llm),
    }).run({
      plan: [
        { description: "Phase 1", tools: ["read"] },
        { description: "Phase 2", tools: ["read"] },
      ],
    });

    expect(result.status).toBe("max_cost");
    expect(result.state.step1).toBe(true);
    expect(llm.callCount).toBe(1); // Only phase 1 ran
  });

  test("phase_budget on non-last phase continues to next", async () => {
    const readTool = createMockTool("read");
    const llm = new MockLLM();

    // Phase 1: loops until max rounds, then force-done
    llm.enqueue(
      mockToolCallResponse({ name: "read", args: { path: "a.ts" } }),
    );
    // Force-done response
    llm.enqueue(
      mockDoneResponse({ partial: true }, "Partial from force"),
    );

    // Phase 2: normal done
    llm.enqueue(
      mockDoneResponse({ partial: true, phase2: true }, "Phase 2 done"),
    );

    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: { read: readTool },
      maxPhaseRounds: 1, // Only 1 round before force-done
      llmCaller: createMockCaller(llm),
    }).run({
      plan: [
        { description: "Phase 1", tools: ["read"] },
        { description: "Phase 2", tools: [] },
      ],
    });

    // Should complete because phase 2 succeeded
    expect(result.status).toBe("completed");
    expect(result.state.phase2).toBe(true);
  });

  test("error in a phase stops execution", async () => {
    const llm = new MockLLM();

    // Phase 1: state validation always fails
    llm.enqueue(mockDoneResponse({ bad: 1 }, "attempt 1"));
    llm.enqueue(mockDoneResponse({ bad: 2 }, "attempt 2"));
    llm.enqueue(mockDoneResponse({ bad: 3 }, "attempt 3"));

    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: {},
      stateSchema: {
        safeParse: () => ({
          success: false,
          error: { issues: [{ path: ["x"], message: "Required" }] },
        }),
      },
      llmCaller: createMockCaller(llm),
    }).run({
      plan: [
        { description: "Phase 1", tools: [] },
        { description: "Phase 2 (never reached)", tools: [] },
      ],
    });

    expect(result.status).toBe("error");
    expect(result.phaseSummaries).toHaveLength(1);
  });

  test("single-phase plan with result", async () => {
    const llm = new MockLLM();
    llm.enqueue(
      mockDoneResponse(
        { complete: true },
        "All done",
        { answer: 42 },
      ),
    );

    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: {},
      llmCaller: createMockCaller(llm),
    }).run({
      plan: [{ description: "Do it", tools: [] }],
    });

    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ answer: 42 });
    expect(result.metrics.totalTokens).toBeGreaterThan(0);
    expect(result.metrics.totalCost).toBeGreaterThan(0);
  });

  test("Phase 0: generates plan from task", async () => {
    const readTool = createMockTool("read");
    const llm = new MockLLM();

    // Phase 0: planning — LLM reads a file then produces plan
    llm.enqueue(
      mockToolCallResponse({ name: "read", args: { path: "src/main.ts" } }),
    );
    llm.enqueue(
      mockDoneResponse(
        {
          plan: [
            { description: "Analyze the code", tools: ["read"] },
            { description: "Write summary", tools: [] },
          ],
          context_gathered: { mainFile: "src/main.ts", lines: 100 },
          task: "Summarize the codebase",
        },
        "Created a 2-phase plan",
      ),
    );

    // Phase 1: analyze
    llm.enqueue(
      mockDoneResponse(
        { context_gathered: { mainFile: "src/main.ts", lines: 100 }, analysis: "It's a CLI tool" },
        "Analyzed the code",
      ),
    );

    // Phase 2: summarize
    llm.enqueue(
      mockDoneResponse(
        { context_gathered: { mainFile: "src/main.ts", lines: 100 }, analysis: "It's a CLI tool", summary: "done" },
        "Wrote summary",
        { summary: "A CLI tool with 100 lines" },
      ),
    );

    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "You are X.",
      tools: { read: readTool },
      llmCaller: createMockCaller(llm),
    }).run({
      task: "Summarize the codebase",
    });

    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ summary: "A CLI tool with 100 lines" });
    // Phase 0 + 2 execution phases = 3 entries in summaries
    expect(result.phaseSummaries).toHaveLength(3);
    expect(result.metrics.phases).toHaveLength(3);
  });

  test("cached prefix contains plan for all phases", async () => {
    const llm = new MockLLM();

    // Phase 1
    llm.enqueue(mockDoneResponse({ step1: true }, "Phase 1"));
    // Phase 2
    llm.enqueue(mockDoneResponse({ step1: true, step2: true }, "Phase 2"));

    await createExecutor({
      model: fakeModel,
      systemPrompt: "You are X.",
      tools: {},
      llmCaller: createMockCaller(llm),
    }).run({
      plan: [
        { description: "First step", tools: [] },
        { description: "Second step", tools: [] },
      ],
    });

    // Both calls should have the same system prompt (cached prefix)
    const call1 = llm.getCall(0);
    const call2 = llm.getCall(1);
    expect(call1.systemPrompt).toContain("First step");
    expect(call1.systemPrompt).toContain("Second step");
    expect(call1.systemPrompt).toBe(call2.systemPrompt);
  });

  test("state carries between phases", async () => {
    const llm = new MockLLM();

    llm.enqueue(mockDoneResponse({ from_phase1: "data" }, "Phase 1"));
    llm.enqueue(
      mockDoneResponse({ from_phase1: "data", from_phase2: "more" }, "Phase 2"),
    );

    await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: {},
      llmCaller: createMockCaller(llm),
    }).run({
      plan: [
        { description: "Phase 1", tools: [] },
        { description: "Phase 2", tools: [] },
      ],
    });

    // Phase 2 should receive phase 1's state in the user message
    const call2 = llm.getCall(1);
    const userMsg = call2.messages[0];
    expect(typeof userMsg.content === "string" ? userMsg.content : "").toContain("from_phase1");
  });
});
