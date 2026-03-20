/**
 * pi-exec tools — the done() tool definition and tool execution bridge.
 *
 * Tool execution follows the same pattern as pi-agent-core's agent-loop:
 * validate arguments → execute → handle errors → produce ToolResultMessage.
 */

import { Type } from "@sinclair/typebox";
import { validateToolArguments } from "@mariozechner/pi-ai";
import type {
  Tool,
  ToolCall,
  ToolResultMessage,
} from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";

// ---------------------------------------------------------------------------
// done() tool definition
// ---------------------------------------------------------------------------

export const doneTool: Tool = {
  name: "done",
  description:
    "Signal that the current phase is complete. Pass your updated working state " +
    "(must include everything subsequent phases need) and a summary of what you accomplished.",
  parameters: Type.Object({
    state: Type.Record(Type.String(), Type.Unknown(), {
      description:
        "Updated working state. Must contain all information that subsequent phases need.",
    }),
    summary: Type.String({
      description: "Human-readable summary of what was accomplished in this phase.",
    }),
    result: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        description:
          "Optional structured output. Use on the final phase to return task results.",
      }),
    ),
  }),
};

/** Parsed done() call arguments. */
export interface DoneCallArgs {
  state: Record<string, unknown>;
  summary: string;
  result?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tool execution bridge: AgentTool → ToolResultMessage
// ---------------------------------------------------------------------------

/**
 * Execute an AgentTool and produce a ToolResultMessage compatible with pi-ai.
 *
 * Follows the same validate → execute → handle pattern as pi-agent-core:
 * 1. Validate arguments against tool schema (via pi-ai's validateToolArguments)
 * 2. Execute the tool with validated args
 * 3. On error, produce an error result (never throw)
 */
export async function executeAgentTool(
  tool: AgentTool<any, any>,
  toolCall: ToolCall,
  signal?: AbortSignal,
): Promise<ToolResultMessage> {
  // Validate arguments against schema (same as pi-agent-core's prepareToolCall)
  let validatedArgs: unknown;
  try {
    validatedArgs = validateToolArguments(tool, toolCall);
  } catch (err) {
    return createErrorResult(
      toolCall,
      err instanceof Error ? err.message : `Argument validation failed: ${String(err)}`,
    );
  }

  try {
    const result = await tool.execute(toolCall.id, validatedArgs, signal);
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: result.content,
      isError: false,
      timestamp: Date.now(),
    };
  } catch (err) {
    return createErrorResult(
      toolCall,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Create an error ToolResultMessage. Used for unknown tools, validation
 * failures, and execution errors. Matches pi-agent-core's pattern.
 */
export function createErrorResult(toolCall: ToolCall, message: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text: message }],
    isError: true,
    timestamp: Date.now(),
  };
}
