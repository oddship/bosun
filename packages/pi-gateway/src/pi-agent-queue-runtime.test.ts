import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ProcessBackend } from "../../pi-agents/src/backend";
import {
  assistantReplyCountFromSession,
  latestAssistantReplyFromSession,
  parseStructuredSiteAction,
  selectRoutingForMessage,
  setRuntimeBackendForTest,
  waitForAgentSessionReadyForTest,
  type QueueRoutingDecision,
  type SiteMessage,
} from "./pi-agent-queue-runtime";
import { createTempDir } from "./test-temp-dir";

const originalEnv = {
  PI_SITE_AGENT_NAME: process.env.PI_SITE_AGENT_NAME,
  PI_SITE_AUTOMATION_AGENT_NAME: process.env.PI_SITE_AUTOMATION_AGENT_NAME,
  PI_SITE_AUTOMATION_ACTIONS: process.env.PI_SITE_AUTOMATION_ACTIONS,
  PI_SITE_ACTION_AGENTS: process.env.PI_SITE_ACTION_AGENTS,
  PI_SITE_STATE_DIR: process.env.PI_SITE_STATE_DIR,
  PI_SITE_SESSION_NAME: process.env.PI_SITE_SESSION_NAME,
  PI_SITE_AGENT_SESSION_PREFIX: process.env.PI_SITE_AGENT_SESSION_PREFIX,
};

function makeMessage(overrides: Partial<SiteMessage> = {}): SiteMessage {
  return {
    id: "msg_1",
    role: "system",
    content: [
      "Site action for pi-steward/control:",
      JSON.stringify({
        type: "site-action",
        action: "maintenance-pulse",
        target: "control",
        payload: { origin: "test" },
      }, null, 2),
      "Treat this as a structured browser event against the maintained website surface. Prefer updating or improving the site/workflow over answering generically when appropriate.",
    ].join("\n\n"),
    ts: "2026-04-12T13:00:00.000Z",
    source: "gateway",
    ...overrides,
  };
}

const tempDirs: string[] = [];

function runtimeStateDir(): string {
  const dir = createTempDir("pi-agent-queue-runtime-state-");
  tempDirs.push(dir);
  return dir;
}

function tempSessionPath(): string {
  const dir = createTempDir("pi-agent-queue-runtime-session-");
  tempDirs.push(dir);
  return join(dir, "session.jsonl");
}

describe("pi-agent queue runtime routing", () => {
  test("parses structured site actions from gateway dispatch content", () => {
    const action = parseStructuredSiteAction(makeMessage().content);
    expect(action).toEqual({
      type: "site-action",
      action: "maintenance-pulse",
      target: "control",
      payload: { origin: "test" },
    });
  });

  test("routes configured automation actions to the automation agent", () => {
    process.env.PI_SITE_AGENT_NAME = "steward";
    process.env.PI_SITE_AUTOMATION_AGENT_NAME = "steward-maintainer";
    process.env.PI_SITE_AUTOMATION_ACTIONS = "maintenance-pulse,surface-review";
    process.env.PI_SITE_ACTION_AGENTS = "";
    process.env.PI_SITE_STATE_DIR = runtimeStateDir();
    process.env.PI_SITE_SESSION_NAME = "pi-steward-control";

    const routing = selectRoutingForMessage(makeMessage());
    expect(routing.mode).toBe("automation");
    expect(routing.agentName).toBe("steward-maintainer");
    expect(routing.sessionPath).toContain("pi-agent-session-steward-maintainer.jsonl");
    expect(routing.tmuxSessionName).toBe("pi-steward-control-steward-maintainer");
  });

  test("routes explicit action agents ahead of the shared automation agent", () => {
    process.env.PI_SITE_AGENT_NAME = "steward";
    process.env.PI_SITE_AUTOMATION_AGENT_NAME = "steward-maintainer";
    process.env.PI_SITE_AUTOMATION_ACTIONS = "surface-review";
    process.env.PI_SITE_ACTION_AGENTS = JSON.stringify({ "maintenance-pulse": "steward-pulse" });
    process.env.PI_SITE_STATE_DIR = runtimeStateDir();
    process.env.PI_SITE_SESSION_NAME = "pi-steward-control";

    const maintenanceRoute = selectRoutingForMessage(makeMessage());
    expect(maintenanceRoute.mode).toBe("automation");
    expect(maintenanceRoute.agentName).toBe("steward-pulse");
    expect(maintenanceRoute.sessionPath).toContain("pi-agent-session-steward-pulse.jsonl");
    expect(maintenanceRoute.tmuxSessionName).toBe("pi-steward-control-steward-pulse");

    const reviewRoute = selectRoutingForMessage(makeMessage({
      content: makeMessage().content.replace("maintenance-pulse", "surface-review"),
    }));
    expect(reviewRoute.mode).toBe("automation");
    expect(reviewRoute.agentName).toBe("steward-maintainer");
    expect(reviewRoute.sessionPath).toContain("pi-agent-session-steward-maintainer.jsonl");
  });

  test("keeps human messages on the default steward agent", () => {
    process.env.PI_SITE_AGENT_NAME = "steward";
    process.env.PI_SITE_AUTOMATION_AGENT_NAME = "steward-maintainer";
    process.env.PI_SITE_AUTOMATION_ACTIONS = "maintenance-pulse,surface-review";
    process.env.PI_SITE_STATE_DIR = runtimeStateDir();
    process.env.PI_SITE_SESSION_NAME = "pi-steward-control";

    const routing = selectRoutingForMessage(makeMessage({
      role: "user",
      content: "please help me plan dinner",
      source: "browser",
    }));

    expect(routing.mode).toBe("default");
    expect(routing.agentName).toBe("steward");
    expect(routing.sessionPath).toContain("pi-agent-session.jsonl");
    expect(routing.tmuxSessionName).toBe("pi-steward-control-steward");
  });

  test("prefers the final_answer text from session output", () => {
    const tempDir = createTempDir("pi-agent-queue-runtime-");
    tempDirs.push(tempDir);
    const sessionPath = join(tempDir, "session.jsonl");

    writeFileSync(sessionPath, [
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "intermediate commentary", textSignature: JSON.stringify({ phase: "commentary" }) },
            { type: "text", text: "final answer", textSignature: JSON.stringify({ phase: "final_answer" }) },
          ],
        },
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "new commentary", textSignature: JSON.stringify({ phase: "commentary" }) },
            { type: "text", text: "new final", textSignature: JSON.stringify({ phase: "final_answer" }) },
          ],
        },
      }),
      "",
    ].join("\n"), "utf-8");

    expect(assistantReplyCountFromSession(sessionPath)).toBe(2);
    expect(latestAssistantReplyFromSession(sessionPath)).toBe("new final");
  });

  test("zmux readiness waits on await-ready and skips tmux capture heuristics", async () => {
    let awaitReadyCalls = 0;
    let captureCalls = 0;

    setRuntimeBackendForTest({
      type: "zmux",
      awaitReady: async () => { awaitReadyCalls += 1; },
      captureTail: async () => {
        captureCalls += 1;
        return { text: "" };
      },
      hasSession: async () => true,
    } as unknown as ProcessBackend);

    const routing: QueueRoutingDecision = {
      agentName: "steward",
      sessionPath: tempSessionPath(),
      tmuxSessionName: "steward-zmux",
      backendTarget: "pane_123",
      mode: "default",
    };

    await waitForAgentSessionReadyForTest(routing);

    expect(awaitReadyCalls).toBe(1);
    expect(captureCalls).toBe(0);
  });

  test("tmux readiness preserves legacy capture heuristic", async () => {
    let awaitReadyCalls = 0;
    let captureCalls = 0;

    setRuntimeBackendForTest({
      type: "tmux",
      awaitReady: async () => { awaitReadyCalls += 1; },
      hasSession: async () => true,
      captureTail: async () => {
        captureCalls += 1;
        return { text: "mesh: connected" };
      },
    } as unknown as ProcessBackend);

    const routing: QueueRoutingDecision = {
      agentName: "steward",
      sessionPath: tempSessionPath(),
      tmuxSessionName: "steward-tmux",
      backendTarget: "steward-tmux",
      mode: "default",
    };

    await waitForAgentSessionReadyForTest(routing);

    expect(awaitReadyCalls).toBe(1);
    expect(captureCalls).toBeGreaterThan(0);
  });
});

afterAll(() => {
  setRuntimeBackendForTest(undefined);
  process.env.PI_SITE_AGENT_NAME = originalEnv.PI_SITE_AGENT_NAME;
  process.env.PI_SITE_AUTOMATION_AGENT_NAME = originalEnv.PI_SITE_AUTOMATION_AGENT_NAME;
  process.env.PI_SITE_AUTOMATION_ACTIONS = originalEnv.PI_SITE_AUTOMATION_ACTIONS;
  process.env.PI_SITE_ACTION_AGENTS = originalEnv.PI_SITE_ACTION_AGENTS;
  process.env.PI_SITE_STATE_DIR = originalEnv.PI_SITE_STATE_DIR;
  process.env.PI_SITE_SESSION_NAME = originalEnv.PI_SITE_SESSION_NAME;
  process.env.PI_SITE_AGENT_SESSION_PREFIX = originalEnv.PI_SITE_AGENT_SESSION_PREFIX;
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});
