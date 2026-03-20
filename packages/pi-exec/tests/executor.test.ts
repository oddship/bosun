import { describe, test, expect, beforeEach } from "bun:test";
import { createExecutor } from "../src/executor.js";
import type { LLMCaller } from "../src/phase.js";
import type { ExecutorOptions } from "../src/executor.js";
import type { PhaseEvent } from "../src/types.js";
import {
  MockLLM,
  mockDoneResponse,
  mockTextResponse,
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

  test("empty plan returns completed immediately", async () => {
    const llm = new MockLLM();

    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: {},
      llmCaller: createMockCaller(llm),
    }).run({
      plan: [],
      initialState: { preserved: true },
    });

    expect(result.status).toBe("completed");
    expect(result.state.preserved).toBe(true);
    expect(llm.callCount).toBe(0);
    expect(result.metrics.phases).toHaveLength(0);
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

  // ---------------------------------------------------------------------------
  // Gate tests
  // ---------------------------------------------------------------------------

  test("gate: passes on first attempt", async () => {
    const readTool = createMockTool("read");
    const llm = new MockLLM();

    // Work phase
    llm.enqueue(mockDoneResponse({ fixed: true }, "Applied fix"));
    // Gate phase — passes
    llm.enqueue(
      mockDoneResponse({ fixed: true }, "Verified", { passed: true }),
    );

    const events: PhaseEvent[] = [];
    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: { read: readTool },
      llmCaller: createMockCaller(llm),
      onPhase: (e) => events.push(e),
    }).run({
      plan: [
        { description: "Fix bug", tools: ["read"], gate: "Verify the fix is correct" },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.state.fixed).toBe(true);
    expect(llm.callCount).toBe(2); // work + gate
    expect(events.some((e) => e.type === "gate_start")).toBe(true);
    expect(events.some((e) => e.type === "gate_pass")).toBe(true);
    expect(events.some((e) => e.type === "gate_fail")).toBe(false);
  });

  test("gate: fails then retries and passes", async () => {
    const readTool = createMockTool("read");
    const editTool = createMockTool("edit");
    const llm = new MockLLM();

    // Attempt 1: work phase
    llm.enqueue(mockDoneResponse({ fixed: false }, "First attempt"));
    // Attempt 1: gate — fails
    llm.enqueue(
      mockDoneResponse({ fixed: false }, "Fix incomplete", {
        passed: false,
        issues: ["The loop still uses < instead of <="],
      }),
    );
    // Attempt 2: work phase retry (with gate failure in state)
    llm.enqueue(mockDoneResponse({ fixed: true }, "Fixed properly"));
    // Attempt 2: gate — passes
    llm.enqueue(
      mockDoneResponse({ fixed: true }, "Verified", { passed: true }),
    );

    const events: PhaseEvent[] = [];
    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: { read: readTool, edit: editTool },
      llmCaller: createMockCaller(llm),
      onPhase: (e) => events.push(e),
    }).run({
      plan: [
        { description: "Fix bug", tools: ["read", "edit"], gate: "Verify fix uses <=" },
      ],
    });

    expect(result.status).toBe("completed");
    expect(result.state.fixed).toBe(true);
    expect(llm.callCount).toBe(4); // work + gate + retry-work + retry-gate

    // Check retry had gate failure context in state
    const retryCall = llm.getCall(2); // third call = retry work phase
    const retryUserMsg = retryCall.messages[0];
    expect(typeof retryUserMsg.content === "string" ? retryUserMsg.content : "").toContain("gate_failure");
    expect(typeof retryUserMsg.content === "string" ? retryUserMsg.content : "").toContain("still uses <");

    // Events
    const gateFails = events.filter((e) => e.type === "gate_fail");
    expect(gateFails).toHaveLength(1);
    expect(gateFails[0].gateIssues).toEqual(["The loop still uses < instead of <="]);
    expect(gateFails[0].gateAttempt).toBe(1);
    expect(events.some((e) => e.type === "gate_pass")).toBe(true);
  });

  test("gate: exhausts maxRetries and returns error", async () => {
    const readTool = createMockTool("read");
    const llm = new MockLLM();

    // maxRetries: 2 → initial gate + 2 retries = 3 gate checks
    // work(1) + gate-fail(1) + retry-work(2) + gate-fail(2) + retry-work(3) + gate-fail(3) = 6
    llm.enqueue(mockDoneResponse({ v: 1 }, "Attempt 1"));
    llm.enqueue(
      mockDoneResponse({ v: 1 }, "Bad", { passed: false, issues: ["Bad"] }),
    );
    llm.enqueue(mockDoneResponse({ v: 2 }, "Attempt 2"));
    llm.enqueue(
      mockDoneResponse({ v: 2 }, "Still bad", { passed: false, issues: ["Still bad"] }),
    );
    llm.enqueue(mockDoneResponse({ v: 3 }, "Attempt 3"));
    llm.enqueue(
      mockDoneResponse({ v: 3 }, "Final fail", { passed: false, issues: ["Final fail"] }),
    );

    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: { read: readTool },
      llmCaller: createMockCaller(llm),
    }).run({
      plan: [
        { description: "Do thing", tools: ["read"], gate: "Check thing", maxRetries: 2 },
      ],
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("gate failed after 2 retries");
    expect(result.error).toContain("Final fail");
    expect(llm.callCount).toBe(6);
  });

  test("gate: custom maxRetries = 1 allows one retry", async () => {
    const llm = new MockLLM();

    // maxRetries: 1 → work + gate-fail + retry-work + gate-fail → error
    llm.enqueue(mockDoneResponse({ v: 1 }, "First"));
    llm.enqueue(
      mockDoneResponse({ v: 1 }, "Nope", { passed: false, issues: ["Wrong"] }),
    );
    llm.enqueue(mockDoneResponse({ v: 2 }, "Retry"));
    llm.enqueue(
      mockDoneResponse({ v: 2 }, "Nope again", { passed: false, issues: ["Still wrong"] }),
    );

    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: {},
      llmCaller: createMockCaller(llm),
    }).run({
      plan: [
        { description: "Do thing", tools: [], gate: "Check", maxRetries: 1 },
      ],
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("gate failed after 1 retry");
    expect(llm.callCount).toBe(4); // work + gate + retry-work + retry-gate
  });

  test("gate: maxRetries = 0 means no retries on failure", async () => {
    const llm = new MockLLM();

    // work + gate-fail → immediate error, no retry
    llm.enqueue(mockDoneResponse({ v: 1 }, "Done"));
    llm.enqueue(
      mockDoneResponse({ v: 1 }, "Failed", { passed: false, issues: ["Broken"] }),
    );

    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: {},
      llmCaller: createMockCaller(llm),
    }).run({
      plan: [
        { description: "Do thing", tools: [], gate: "Check", maxRetries: 0 },
      ],
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("gate failed");
    expect(llm.callCount).toBe(2); // work + gate, no retry
  });

  test("gate: no gate field means no verification", async () => {
    const llm = new MockLLM();

    llm.enqueue(mockDoneResponse({ ok: true }, "Done"));

    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: {},
      llmCaller: createMockCaller(llm),
    }).run({
      plan: [{ description: "No gate", tools: [] }],
    });

    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(1); // just the work phase, no gate
  });

  test("gate: _gate_failure cleaned from state before next phase", async () => {
    const readTool = createMockTool("read");
    const llm = new MockLLM();

    // Phase 1: work + gate fail + retry work + gate pass
    llm.enqueue(mockDoneResponse({ p1: true }, "Phase 1 first attempt"));
    llm.enqueue(
      mockDoneResponse({ p1: true }, "Bad", { passed: false, issues: ["Fix it"] }),
    );
    llm.enqueue(mockDoneResponse({ p1: true, p1_fixed: true }, "Phase 1 fixed"));
    llm.enqueue(
      mockDoneResponse({ p1: true, p1_fixed: true }, "Good", { passed: true }),
    );
    // Phase 2: should NOT see _gate_failure in state
    llm.enqueue(mockDoneResponse({ p1: true, p1_fixed: true, p2: true }, "Phase 2"));

    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: { read: readTool },
      llmCaller: createMockCaller(llm),
    }).run({
      plan: [
        { description: "Phase 1", tools: ["read"], gate: "Verify phase 1" },
        { description: "Phase 2", tools: ["read"] },
      ],
    });

    expect(result.status).toBe("completed");

    // Phase 2's user message should NOT contain _gate_failure
    const phase2Call = llm.getCall(4); // 5th call = phase 2 work
    const userMsg = phase2Call.messages[0];
    const content = typeof userMsg.content === "string" ? userMsg.content : "";
    expect(content).not.toContain("gate_failure");
    expect(content).toContain("p1_fixed");
  });

  test("gate: uses gate prompt with verification instructions", async () => {
    const readTool = createMockTool("read");
    const llm = new MockLLM();

    llm.enqueue(mockDoneResponse({ done: true }, "Work done"));
    llm.enqueue(
      mockDoneResponse({ done: true }, "Verified", { passed: true }),
    );

    await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: { read: readTool },
      llmCaller: createMockCaller(llm),
    }).run({
      plan: [
        { description: "Fix the bug", tools: ["read"], gate: "Tests pass and fix is correct" },
      ],
    });

    // Gate call should have the gate prompt, not the normal phase prompt
    const gateCall = llm.getCall(1);
    const gateUserMsg = gateCall.messages[0];
    const content = typeof gateUserMsg.content === "string" ? gateUserMsg.content : "";
    expect(content).toContain("Verification Gate");
    expect(content).toContain("Tests pass and fix is correct");
    expect(content).toContain("Fix the bug");
    expect(content).toContain("result");
    expect(content).toContain("passed");
  });

  test("gate: retry work phase returning phase_budget returns error (not silent continue)", async () => {
    const llm = new MockLLM();

    // Work phase succeeds
    llm.enqueue(mockDoneResponse({ v: 1 }, "Done"));
    // Gate fails
    llm.enqueue(
      mockDoneResponse({ v: 1 }, "Bad", { passed: false, issues: ["Wrong"] }),
    );
    // Retry work phase — returns text only, hits max rounds → force-done → phase_budget
    llm.enqueue(mockTextResponse("Hmm"));
    llm.enqueue(mockTextResponse("Still thinking"));
    llm.enqueue(mockTextResponse("Can't do it"));
    // Force-done attempt
    llm.enqueue(mockDoneResponse({ v: 1, partial: true }, "Forced"));

    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: {},
      llmCaller: createMockCaller(llm),
      maxPhaseRounds: 3,
    }).run({
      plan: [
        { description: "Phase 1", tools: [], gate: "Check" },
        { description: "Phase 2 should NOT run", tools: [] },
      ],
    });

    // Should NOT silently continue to Phase 2
    expect(result.status).toBe("phase_budget");
    expect(result.error).toContain("gate retry");
    // Phase 2 should never have run
    expect(result.phaseSummaries.some((s) => s.includes("Phase 2"))).toBe(false);
  });

  test("gate: cost limit stops retry loop", async () => {
    const llm = new MockLLM();

    // Each mock call = $0.0031. Set cost limit to $0.003 — even the work phase
    // puts us at $0.0031, so the cost check at retry=0 should fire immediately.
    llm.enqueue(mockDoneResponse({ v: 1 }, "Done"));
    // Gate won't even run — cost limit fires before it

    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: {},
      llmCaller: createMockCaller(llm),
      maxCostUsd: 0.003,
    }).run({
      plan: [
        { description: "Do thing", tools: [], gate: "Check", maxRetries: 5 },
      ],
    });

    expect(result.status).toBe("max_cost");
    expect(llm.callCount).toBe(1); // Only work phase, gate never ran
  });

  test("gate: work phase error skips gate", async () => {
    const llm = new MockLLM();

    // Work phase errors — force done returns phase_budget
    llm.enqueue(mockTextResponse("I can't do this"));
    llm.enqueue(mockTextResponse("Still can't"));
    llm.enqueue(mockTextResponse("Nope")); // maxPhaseRounds will force-done
    // Force-done call
    llm.enqueue(mockDoneResponse({ partial: true }, "Forced"));

    const result = await createExecutor({
      model: fakeModel,
      systemPrompt: "Test",
      tools: {},
      llmCaller: createMockCaller(llm),
      maxPhaseRounds: 3,
    }).run({
      plan: [
        { description: "Impossible task", tools: [], gate: "Should never run" },
      ],
    });

    // Gate should NOT have run — work phase returned phase_budget, not completed
    // The executor should return the budget result, not try the gate
    expect(result.status).toBe("phase_budget");
  });
});
