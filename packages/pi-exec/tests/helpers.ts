/**
 * Test helpers — mock LLM, mock tools, and assertion utilities.
 */

import type {
  AssistantMessage,
  Context,
  Message,
  Tool,
  ToolCall,
} from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type, type TSchema } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Mock AssistantMessage factory
// ---------------------------------------------------------------------------

let toolCallIdCounter = 0;

export function resetIdCounter(): void {
  toolCallIdCounter = 0;
}

function nextToolCallId(): string {
  return `tc_${++toolCallIdCounter}`;
}

export function mockTextResponse(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    usage: mockUsage(),
    stopReason: "stop",
    api: "openai-codex-responses" as any,
    provider: "openai-codex" as any,
    model: "gpt-5.4-mini",
    timestamp: Date.now(),
  };
}

export function mockToolCallResponse(...calls: Array<{ name: string; args: Record<string, any> }>): AssistantMessage {
  return {
    role: "assistant",
    content: calls.map((c) => ({
      type: "toolCall" as const,
      id: nextToolCallId(),
      name: c.name,
      arguments: c.args,
    })),
    usage: mockUsage(),
    stopReason: "toolUse" as any,
    api: "openai-codex-responses" as any,
    provider: "openai-codex" as any,
    model: "gpt-5.4-mini",
    timestamp: Date.now(),
  };
}

export function mockDoneResponse(state: Record<string, unknown>, summary: string, result?: Record<string, unknown>): AssistantMessage {
  return mockToolCallResponse({
    name: "done",
    args: { state, summary, ...(result ? { result } : {}) },
  });
}

export function mockDoneWithToolsResponse(
  state: Record<string, unknown>,
  summary: string,
  ...extraTools: Array<{ name: string; args: Record<string, any> }>
): AssistantMessage {
  return mockToolCallResponse(
    ...extraTools,
    { name: "done", args: { state, summary } },
  );
}

function mockUsage() {
  return {
    input: 1000,
    output: 500,
    cacheRead: 800,
    cacheWrite: 0,
    totalTokens: 2300,
    cost: { input: 0.001, output: 0.002, cacheRead: 0.0001, cacheWrite: 0, total: 0.0031 },
  };
}

// ---------------------------------------------------------------------------
// Mock streamSimple / completeSimple
// ---------------------------------------------------------------------------

/**
 * A sequence of responses that a mock LLM will return in order.
 * Each call to streamSimple/completeSimple pops the next response.
 */
export class MockLLM {
  private responses: AssistantMessage[] = [];
  private callLog: Array<{ systemPrompt: string; messages: Message[]; tools: Tool[] }> = [];

  /** Queue responses in order. */
  enqueue(...responses: AssistantMessage[]): void {
    this.responses.push(...responses);
  }

  /** Get all calls made so far. */
  getCalls() {
    return this.callLog;
  }

  /** Get the Nth call (0-indexed). */
  getCall(n: number) {
    return this.callLog[n];
  }

  /** Get total number of calls. */
  get callCount(): number {
    return this.callLog.length;
  }

  /** Pop next response, recording the call. */
  next(context: Context, _options?: any): AssistantMessage {
    this.callLog.push({
      systemPrompt: context.systemPrompt || "",
      messages: context.messages,
      tools: context.tools || [],
    });

    const response = this.responses.shift();
    if (!response) {
      throw new Error(
        `MockLLM: no more responses queued. Call #${this.callLog.length}. ` +
        `Last system prompt: ${context.systemPrompt?.slice(0, 100)}...`,
      );
    }
    return response;
  }
}

// ---------------------------------------------------------------------------
// Mock AgentTool factory
// ---------------------------------------------------------------------------

/**
 * Create a mock AgentTool that records calls and returns a fixed result.
 */
export function createMockTool(
  name: string,
  resultText = `${name} result`,
): AgentTool<any, any> & { calls: Array<{ id: string; params: any }> } {
  const calls: Array<{ id: string; params: any }> = [];

  return {
    name,
    label: name,
    description: `Mock ${name} tool`,
    parameters: Type.Object({}),
    calls,
    async execute(toolCallId: string, params: any): Promise<AgentToolResult<any>> {
      calls.push({ id: toolCallId, params });
      return {
        content: [{ type: "text", text: resultText }],
        details: {},
      };
    },
  };
}

/**
 * Create a mock AgentTool that throws an error.
 */
export function createFailingTool(name: string, errorMessage = `${name} failed`): AgentTool<any, any> {
  return {
    name,
    label: name,
    description: `Failing mock ${name} tool`,
    parameters: Type.Object({}),
    async execute(): Promise<AgentToolResult<any>> {
      throw new Error(errorMessage);
    },
  };
}
