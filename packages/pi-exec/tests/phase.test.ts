import { describe, test, expect, beforeEach } from "bun:test";
import type { Context, AssistantMessage } from "@mariozechner/pi-ai";
import { runPhase, type LLMCaller } from "../src/phase.js";
import type { ExecutorConfig } from "../src/types.js";
import {
  MockLLM,
  mockDoneResponse,
  mockToolCallResponse,
  mockTextResponse,
  mockDoneWithToolsResponse,
  createMockTool,
  createFailingTool,
  resetIdCounter,
} from "./helpers.js";

// Fake model (never used directly — all calls go through MockLLM)
const fakeModel = { id: "test", api: "test", provider: "test" } as any;

function createMockCaller(mockLLM: MockLLM): LLMCaller {
  return {
    async call(model, context, options, onStreamEvent) {
      return mockLLM.next(context, options);
    },
  };
}

function baseConfig(overrides: Partial<ExecutorConfig> = {}): ExecutorConfig {
  return {
    model: fakeModel,
    systemPrompt: "Test executor",
    tools: {},
    phaseBudget: 100_000, // high so it doesn't trigger
    maxPhaseRounds: 15,
    ...overrides,
  };
}

beforeEach(() => resetIdCounter());

describe("runPhase", () => {
  test("simple phase: LLM calls done() immediately", async () => {
    const llm = new MockLLM();
    llm.enqueue(
      mockDoneResponse({ analyzed: true }, "Analyzed the code"),
    );

    const result = await runPhase({
      model: fakeModel,
      cachedPrefix: "You are X.\n## Plan\n  Phase 1: Analyze",
      phase: { description: "Analyze the code", tools: [] },
      phaseIndex: 0,
      totalPhases: 1,
      state: {},
      config: baseConfig(),
      sessionId: "test-session",
      priorCost: 0,
      llmCaller: createMockCaller(llm),
    });

    expect(result.status).toBe("completed");
    expect(result.state).toEqual({ analyzed: true });
    expect(result.summary).toBe("Analyzed the code");
    expect(result.metrics.rounds).toBe(1);
    expect(llm.callCount).toBe(1);
  });

  test("phase with tool calls then done()", async () => {
    const readTool = createMockTool("read", "file contents here");
    const llm = new MockLLM();

    // Round 1: LLM calls read
    llm.enqueue(
      mockToolCallResponse({ name: "read", args: { path: "auth.ts" } }),
    );
    // Round 2: LLM calls done
    llm.enqueue(
      mockDoneResponse({ file_content: "..." }, "Read auth.ts"),
    );

    const result = await runPhase({
      model: fakeModel,
      cachedPrefix: "prefix",
      phase: { description: "Read files", tools: ["read"] },
      phaseIndex: 0,
      totalPhases: 2,
      state: {},
      config: baseConfig({ tools: { read: readTool } }),
      sessionId: "test",
      priorCost: 0,
      llmCaller: createMockCaller(llm),
    });

    expect(result.status).toBe("completed");
    expect(result.state).toEqual({ file_content: "..." });
    expect(readTool.calls).toHaveLength(1);
    expect(llm.callCount).toBe(2);
  });

  test("tool failure is reported to LLM", async () => {
    const failTool = createFailingTool("bash", "command not found");
    const llm = new MockLLM();

    // Round 1: LLM calls bash
    llm.enqueue(
      mockToolCallResponse({ name: "bash", args: { command: "invalid" } }),
    );
    // Round 2: LLM sees error, calls done
    llm.enqueue(
      mockDoneResponse({ error: "bash failed" }, "Tool failed, noted"),
    );

    const result = await runPhase({
      model: fakeModel,
      cachedPrefix: "prefix",
      phase: { description: "Run tests", tools: ["bash"] },
      phaseIndex: 0,
      totalPhases: 1,
      state: {},
      config: baseConfig({ tools: { bash: failTool } }),
      sessionId: "test",
      priorCost: 0,
      llmCaller: createMockCaller(llm),
    });

    expect(result.status).toBe("completed");
    expect(result.state.error).toBe("bash failed");

    // Verify the tool result was marked as error in the messages sent to LLM
    const secondCall = llm.getCall(1);
    const toolResult = secondCall.messages.find(
      (m) => m.role === "toolResult",
    );
    expect(toolResult).toBeDefined();
    expect((toolResult as any).isError).toBe(true);
  });

  test("max rounds triggers force-done", async () => {
    const readTool = createMockTool("read");
    const llm = new MockLLM();

    // Fill with tool calls up to maxRounds
    for (let i = 0; i < 3; i++) {
      llm.enqueue(
        mockToolCallResponse({ name: "read", args: { path: `file${i}.ts` } }),
      );
    }
    // Force-done response
    llm.enqueue(
      mockDoneResponse({ partial: true }, "Forced done"),
    );

    const result = await runPhase({
      model: fakeModel,
      cachedPrefix: "prefix",
      phase: { description: "Read lots", tools: ["read"] },
      phaseIndex: 0,
      totalPhases: 1,
      state: {},
      config: baseConfig({ tools: { read: readTool }, maxPhaseRounds: 3 }),
      sessionId: "test",
      priorCost: 0,
      llmCaller: createMockCaller(llm),
    });

    expect(result.status).toBe("phase_budget");
    expect(result.state).toEqual({ partial: true });
  });

  test("budget warning appended at 80%", async () => {
    const readTool = createMockTool("read");
    const llm = new MockLLM();

    // Each mock response = 2300 tokens. Budget = 5000.
    // Round 1: 0 tokens → no warning → call → cumulative = 2300 (46% of 5000)
    // Execute tool → round 2 start: 2300 > 5000*0.8 = 4000? No (46%)
    // Round 2: no warning still → call → cumulative = 4600 (92%)
    // Execute tool → round 3: 4600 > 4000? Yes → WARNING appended
    llm.enqueue(
      mockToolCallResponse({ name: "read", args: { path: "a.ts" } }),
    );
    llm.enqueue(
      mockToolCallResponse({ name: "read", args: { path: "b.ts" } }),
    );
    // Round 3: should see budget warning in system prompt
    llm.enqueue(
      mockDoneResponse({ done: true }, "Done with budget warning"),
    );

    const result = await runPhase({
      model: fakeModel,
      cachedPrefix: "prefix",
      phase: { description: "Read", tools: ["read"] },
      phaseIndex: 0,
      totalPhases: 1,
      state: {},
      config: baseConfig({ tools: { read: readTool }, phaseBudget: 5000 }),
      sessionId: "test",
      priorCost: 0,
      llmCaller: createMockCaller(llm),
    });

    // Check that the third call had the budget warning
    const call3 = llm.getCall(2);
    expect(call3.systemPrompt).toContain("Approaching phase budget");
    // First two calls should NOT have the warning
    expect(llm.getCall(0).systemPrompt).not.toContain("Approaching phase budget");
    expect(llm.getCall(1).systemPrompt).not.toContain("Approaching phase budget");
  });

  test("done() with co-occurring tools: tools executed, results discarded", async () => {
    const readTool = createMockTool("read");
    const llm = new MockLLM();

    // LLM calls read + done in same response
    llm.enqueue(
      mockDoneWithToolsResponse(
        { result: "data" },
        "Done (with extra tool)",
        { name: "read", args: { path: "extra.ts" } },
      ),
    );

    const events: any[] = [];
    const result = await runPhase({
      model: fakeModel,
      cachedPrefix: "prefix",
      phase: { description: "Mixed", tools: ["read"] },
      phaseIndex: 0,
      totalPhases: 1,
      state: {},
      config: baseConfig({
        tools: { read: readTool },
        onPhase: (e) => events.push(e),
      }),
      sessionId: "test",
      priorCost: 0,
      llmCaller: createMockCaller(llm),
    });

    expect(result.status).toBe("completed");
    expect(result.state).toEqual({ result: "data" });
    // The read tool WAS called (co-occurring tools are executed)
    expect(readTool.calls).toHaveLength(1);
    // A warning was emitted
    expect(events.some((e) => e.type === "force_done")).toBe(true);
  });

  test("state validation: retry on failure", async () => {
    const llm = new MockLLM();

    // Round 1: invalid state (missing required field)
    llm.enqueue(
      mockDoneResponse({ incomplete: true }, "First attempt"),
    );
    // Round 2: valid state
    llm.enqueue(
      mockDoneResponse({ required_field: "present" }, "Fixed state"),
    );

    const result = await runPhase({
      model: fakeModel,
      cachedPrefix: "prefix",
      phase: { description: "Validate", tools: [] },
      phaseIndex: 0,
      totalPhases: 1,
      state: {},
      config: baseConfig({
        stateSchema: {
          safeParse: (data: any) => {
            if (data.required_field) {
              return { success: true };
            }
            return {
              success: false,
              error: {
                issues: [{ path: ["required_field"], message: "Required" }],
              },
            };
          },
        },
      }),
      sessionId: "test",
      priorCost: 0,
      llmCaller: createMockCaller(llm),
    });

    expect(result.status).toBe("completed");
    expect(result.state.required_field).toBe("present");
    expect(llm.callCount).toBe(2);
  });

  test("state validation: fails after max retries", async () => {
    const llm = new MockLLM();

    // 3 attempts all invalid (initial + 2 retries)
    llm.enqueue(mockDoneResponse({ bad: 1 }, "attempt 1"));
    llm.enqueue(mockDoneResponse({ bad: 2 }, "attempt 2"));
    llm.enqueue(mockDoneResponse({ bad: 3 }, "attempt 3"));

    const result = await runPhase({
      model: fakeModel,
      cachedPrefix: "prefix",
      phase: { description: "Validate", tools: [] },
      phaseIndex: 0,
      totalPhases: 1,
      state: {},
      config: baseConfig({
        stateSchema: {
          safeParse: () => ({
            success: false,
            error: { issues: [{ path: ["x"], message: "Always fails" }] },
          }),
        },
      }),
      sessionId: "test",
      priorCost: 0,
      llmCaller: createMockCaller(llm),
    });

    expect(result.status).toBe("error");
    expect(result.error).toContain("validation failed");
  });

  test("unknown tool in phase throws", async () => {
    expect(
      runPhase({
        model: fakeModel,
        cachedPrefix: "prefix",
        phase: { description: "Bad", tools: ["nonexistent"] },
        phaseIndex: 0,
        totalPhases: 1,
        state: {},
        config: baseConfig(),
        sessionId: "test",
        priorCost: 0,
        llmCaller: createMockCaller(new MockLLM()),
      }),
    ).rejects.toThrow('Unknown tool "nonexistent"');
  });

  test("text-only response triggers done() nudge", async () => {
    const llm = new MockLLM();

    // Round 1: LLM just outputs text, no tools
    llm.enqueue(mockTextResponse("I'm thinking about it..."));
    // Round 2: LLM calls done after nudge
    llm.enqueue(mockDoneResponse({ thought: true }, "Thought about it"));

    const result = await runPhase({
      model: fakeModel,
      cachedPrefix: "prefix",
      phase: { description: "Think", tools: [] },
      phaseIndex: 0,
      totalPhases: 1,
      state: {},
      config: baseConfig(),
      sessionId: "test",
      priorCost: 0,
      llmCaller: createMockCaller(llm),
    });

    expect(result.status).toBe("completed");
    // Check nudge was sent
    const call2 = llm.getCall(1);
    const nudge = call2.messages.find(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("must call done()"),
    );
    expect(nudge).toBeDefined();
  });

  test("state diff is computed correctly", async () => {
    const llm = new MockLLM();
    llm.enqueue(
      mockDoneResponse({ existing: "changed", added: "new" }, "Updated state"),
    );

    const result = await runPhase({
      model: fakeModel,
      cachedPrefix: "prefix",
      phase: { description: "Update", tools: [] },
      phaseIndex: 0,
      totalPhases: 1,
      state: { existing: "original", removed: true },
      config: baseConfig(),
      sessionId: "test",
      priorCost: 0,
      llmCaller: createMockCaller(llm),
    });

    expect(result.stateDiff.added).toContain("added");
    expect(result.stateDiff.removed).toContain("removed");
    expect(result.stateDiff.changed).toContain("existing");
  });
});
