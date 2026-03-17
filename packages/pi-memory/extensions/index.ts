import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  executeMemoryGet,
  executeMemoryMultiGet,
  executeMemorySearch,
  executeMemoryStatus,
} from "../src/tools.js";

const MemoryParams = Type.Object({
  action: Type.Union([
    Type.Literal("search"),
    Type.Literal("get"),
    Type.Literal("multi_get"),
    Type.Literal("status"),
  ], { description: "Memory operation to perform" }),
  query: Type.Optional(Type.String({ description: "Search query for action=search" })),
  mode: Type.Optional(
    Type.Union([
      Type.Literal("keyword"),
      Type.Literal("hybrid"),
    ], { description: "Search mode for action=search" }),
  ),
  collections: Type.Optional(
    Type.Array(Type.String(), { description: "Optional collection filters for action=search" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of search results for action=search" })),
  minScore: Type.Optional(Type.Number({ description: "Minimum score threshold for action=search" })),
  intent: Type.Optional(Type.String({ description: "Disambiguating intent for action=search in hybrid mode" })),
  id: Type.Optional(Type.String({ description: "Document docid (#abc123) or path for action=get" })),
  full: Type.Optional(Type.Boolean({ description: "Return full document content for action=get" })),
  fromLine: Type.Optional(Type.Number({ description: "Starting line number for sliced retrieval with action=get" })),
  maxLines: Type.Optional(Type.Number({ description: "Maximum number of lines for action=get" })),
  pattern: Type.Optional(Type.String({ description: "Glob, comma-separated list, or docids for action=multi_get" })),
  maxBytes: Type.Optional(Type.Number({ description: "Skip files larger than this size for action=multi_get" })),
});

function asText(result: unknown): { type: "text"; text: string }[] {
  return [{ type: "text", text: JSON.stringify(result, null, 2) }];
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "memory",
    label: "Memory",
    description: "Search and retrieve curated markdown memory like sessions, plans, docs, skills, and agent definitions. Prefer over grep when recalling prior context rather than exact code symbols. Use action=search|get|multi_get|status. Required params per action: search→query, get→id, multi_get→pattern.",
    parameters: MemoryParams,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.sessionManager.getCwd();

      if (params.action === "search") {
        if (!params.query) {
          return {
            content: asText({ error: "query_required", message: "action=search requires query" }),
            isError: true,
          };
        }
        const result = await executeMemorySearch(cwd, {
          query: params.query,
          mode: params.mode,
          collections: params.collections,
          limit: params.limit,
          minScore: params.minScore,
          intent: params.intent,
        });
        return { content: asText(result), details: result };
      }

      if (params.action === "get") {
        if (!params.id) {
          return {
            content: asText({ error: "id_required", message: "action=get requires id" }),
            isError: true,
          };
        }
        const result = await executeMemoryGet(cwd, {
          id: params.id,
          full: params.full,
          fromLine: params.fromLine,
          maxLines: params.maxLines,
        });
        return {
          content: asText(result),
          details: result,
          isError: "error" in (result as Record<string, unknown>),
        };
      }

      if (params.action === "multi_get") {
        if (!params.pattern) {
          return {
            content: asText({ error: "pattern_required", message: "action=multi_get requires pattern" }),
            isError: true,
          };
        }
        const result = await executeMemoryMultiGet(cwd, {
          pattern: params.pattern,
          maxBytes: params.maxBytes,
        });
        return { content: asText(result), details: result };
      }

      if (params.action === "status") {
        const result = await executeMemoryStatus(cwd);
        return { content: asText(result), details: result };
      }

      return {
        content: asText({ error: "unknown_action", message: `Unknown action: ${String(params.action)}` }),
        isError: true,
      };
    },
  });
}
