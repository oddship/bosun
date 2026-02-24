/**
 * pi-session-context — Session info and handoff creation for Pi.
 *
 * Tools:
 * - session_context: get current session ID, file, name, cwd
 * - handoff: create a handoff markdown template for the current session
 *
 * Handoff files are picked up by pi-daemon's fill-handoff handler
 * which analyzes the session and fills in content.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export default function (pi: ExtensionAPI) {
  // --- session_context tool ---
  pi.registerTool({
    name: "session_context",
    label: "Session Context",
    description: "Get current session info (ID, file path, name, cwd) for context management.",
    parameters: Type.Object({}),

    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionFile = ctx.sessionManager.getSessionFile();
      const cwd = ctx.sessionManager.getCwd();
      const sessionName = pi.getSessionName();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                session_id: sessionId,
                session_file: sessionFile || null,
                session_name: sessionName || null,
                cwd,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  });

  // --- handoff tool ---
  pi.registerTool({
    name: "handoff",
    label: "Create Handoff",
    description:
      "Create a handoff document for the current session. The daemon will analyze the session and fill in content. Use for context transfer between sessions.",
    parameters: Type.Object({
      focus: Type.Optional(
        Type.String({ description: "Focus area or reason for handoff" }),
      ),
    }),

    async execute(_id, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const sessionFile = ctx.sessionManager.getSessionFile();

      if (!sessionFile) {
        return {
          content: [{ type: "text", text: "Error: No session file (ephemeral session?)" }],
          isError: true,
        };
      }

      const USER = process.env.USER || process.env.LOGNAME || "unknown";
      const workspace =
        process.env.BOSUN_WORKSPACE || `${ctx.sessionManager.getCwd()}/workspace`;
      const focus = params.focus || "";

      // Parse session for metadata
      let titleHint = "Session handoff";
      let modelId = "unknown";
      const filesModified = new Set<string>();

      try {
        const content = readFileSync(sessionFile, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);
        const events = lines
          .slice(0, 100)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        const firstUserMsg = events.find(
          (e: Record<string, unknown>) =>
            e.type === "message" &&
            (e.message as Record<string, unknown>)?.role === "user",
        );
        if (firstUserMsg) {
          const msgContent = (firstUserMsg.message as Record<string, unknown>)
            ?.content as Array<Record<string, unknown>> | undefined;
          if (msgContent?.[0]?.text) {
            titleHint = (msgContent[0].text as string).slice(0, 50);
          }
        }

        const modelEvent = events.find(
          (e: Record<string, unknown>) => e.type === "model_change",
        );
        if (modelEvent) modelId = (modelEvent as Record<string, unknown>).modelId as string || "unknown";

        for (const event of events) {
          if (
            event?.type === "message" &&
            (event.message as Record<string, unknown>)?.role === "assistant"
          ) {
            for (const part of (event.message as Record<string, unknown[]>)?.content || []) {
              const p = part as Record<string, unknown>;
              if (
                p.type === "toolCall" &&
                (p.name === "write" || p.name === "edit")
              ) {
                const args = p.arguments as Record<string, unknown> | undefined;
                if (args?.path) filesModified.add(args.path as string);
              }
            }
          }
        }
      } catch {
        // Best effort — continue with defaults
      }

      // Generate output path
      const now = new Date();
      const dateFolder = now.toISOString().slice(0, 7); // YYYY-MM
      const day = String(now.getDate()).padStart(2, "0");
      const hour = String(now.getHours()).padStart(2, "0");
      const minute = String(now.getMinutes()).padStart(2, "0");
      const slug = titleHint
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 50);

      const outputPath = `${workspace}/users/${USER}/handoffs/${dateFolder}/${day}-${hour}-${minute}-${slug}.md`;
      mkdirSync(dirname(outputPath), { recursive: true });

      const filesYaml =
        [...filesModified].map((f) => `  - ${f}`).join("\n") || "  []";
      const filesList =
        [...filesModified].map((f) => `- \`${f}\``).join("\n") || "- None";

      const template = `---
type: handoff
status: pending
created: ${now.toISOString()}
picked_up_at: null
title: "${titleHint}"
session_file: ${sessionFile}
session_id: ${sessionId}
model: ${modelId}
files_modified:
${filesYaml}
---

# Handoff: ${titleHint}

## Context
${focus ? `Focus: ${focus}\n\n` : ""}<!-- AGENT: Summarize what was being worked on -->

## Key Decisions
<!-- AGENT: List important decisions made during the session -->

## Current State
<!-- AGENT: Describe what's completed, in progress, and blocked -->

## Next Steps
<!-- AGENT: List recommended next steps -->

## Files Modified
${filesList}

---
*Handoff from session: ${sessionId}*
*Continue with: /pickup*
`;

      writeFileSync(outputPath, template);

      return {
        content: [
          {
            type: "text",
            text: `Handoff created: ${outputPath}\n\nDaemon will analyze session and fill in content.\nUse /pickup when ready.`,
          },
        ],
      };
    },
  });
}
