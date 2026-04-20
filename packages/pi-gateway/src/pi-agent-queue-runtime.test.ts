import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ProcessBackend } from "../../pi-agents/src/backend";
import {
  assistantReplyCountFromSession,
  formatMessageForAgent,
  latestAssistantReplyFromSession,
  parseStructuredSiteAction,
  processInboxForTest,
  replyTextForRuntimeError,
  resetQueueRuntimeForTest,
  runBrowserMessageHandler,
  selectRoutingForMessage,
  setMessageProcessorForTest,
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
  PI_SITE_INBOX_FILE: process.env.PI_SITE_INBOX_FILE,
  PI_SITE_OUTBOX_FILE: process.env.PI_SITE_OUTBOX_FILE,
  PI_SITE_REPLIES_FILE: process.env.PI_SITE_REPLIES_FILE,
  PI_SITE_SESSION_NAME: process.env.PI_SITE_SESSION_NAME,
  PI_SITE_AGENT_SESSION_PREFIX: process.env.PI_SITE_AGENT_SESSION_PREFIX,
  PI_SITE_BROWSER_MESSAGE_HANDLER: process.env.PI_SITE_BROWSER_MESSAGE_HANDLER,
  PI_SITE_BROWSER_MESSAGE_HANDLER_TIMEOUT_MS: process.env.PI_SITE_BROWSER_MESSAGE_HANDLER_TIMEOUT_MS,
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

function configureQueueRuntimeEnv(overrides: {
  automationActions?: string;
  actionAgents?: Record<string, string>;
} = {}): { inboxFile: string; outboxFile: string; repliesFile: string } {
  const dir = runtimeStateDir();
  const inboxFile = join(dir, "inbox.json");
  const outboxFile = join(dir, "outbox.json");
  const repliesFile = join(dir, "replies.json");

  process.env.PI_SITE_AGENT_NAME = "steward";
  process.env.PI_SITE_AUTOMATION_AGENT_NAME = "steward-maintainer";
  process.env.PI_SITE_AUTOMATION_ACTIONS = overrides.automationActions ?? "maintenance-pulse,surface-review";
  process.env.PI_SITE_ACTION_AGENTS = JSON.stringify(overrides.actionAgents ?? {});
  process.env.PI_SITE_STATE_DIR = dir;
  process.env.PI_SITE_INBOX_FILE = inboxFile;
  process.env.PI_SITE_OUTBOX_FILE = outboxFile;
  process.env.PI_SITE_REPLIES_FILE = repliesFile;
  process.env.PI_SITE_SESSION_NAME = "pi-steward-control";

  return { inboxFile, outboxFile, repliesFile };
}

function readMessages(path: string): SiteMessage[] {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf-8")) as SiteMessage[];
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for condition");
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

  test("formats browser user messages as a single-line metadata wrapper before agent delivery", () => {
    const formatted = formatMessageForAgent(makeMessage({
      role: "user",
      source: "browser",
      content: "I want to track my weight daily",
      actorId: "actor_owner",
      actorLogin: "rhnvrm@github",
      visibility: "household",
    }));

    expect(formatted).toContain("Website user turn: {");
    expect(formatted).toContain('"type":"website-user-message"');
    expect(formatted).toContain('"messageId":"msg_1"');
    expect(formatted).toContain('"actorId":"actor_owner"');
    expect(formatted).toContain('"actorLogin":"rhnvrm@github"');
    expect(formatted).toContain('"visibility":"household"');
    expect(formatted).toContain('"rawUserText":"I want to track my weight daily"');
    expect(formatted).not.toContain("\n");
  });

  test("leaves non-browser messages unchanged when formatting for agent delivery", () => {
    const content = makeMessage().content;
    expect(formatMessageForAgent(makeMessage())).toBe(content);
  });

  test("runs the configured browser message handler before agent delivery", () => {
    const dir = createTempDir("pi-agent-queue-runtime-handler-");
    tempDirs.push(dir);
    const handlerPath = join(dir, "handler.js");
    writeFileSync(handlerPath, [
      'const handled = JSON.stringify({ handled: true, reply: "handled directly" });',
      'process.stdout.write(`${handled}\\n`);',
    ].join("\n"), "utf-8");

    process.env.PI_SITE_BROWSER_MESSAGE_HANDLER = handlerPath;

    const reply = runBrowserMessageHandler(makeMessage({
      role: "user",
      source: "browser",
      content: "I want to track my weight daily",
      actorId: "actor_owner",
      actorLogin: "rhnvrm@github",
      visibility: "household",
    }));

    expect(reply).toBe("handled directly");
  });

  test("falls back to the agent when the browser message handler declines", () => {
    const dir = createTempDir("pi-agent-queue-runtime-handler-");
    tempDirs.push(dir);
    const handlerPath = join(dir, "handler.js");
    writeFileSync(handlerPath, 'process.stdout.write(`${JSON.stringify({ handled: false })}\\n`);', "utf-8");

    process.env.PI_SITE_BROWSER_MESSAGE_HANDLER = handlerPath;

    const reply = runBrowserMessageHandler(makeMessage({
      role: "user",
      source: "browser",
      content: "hello",
    }));

    expect(reply).toBeNull();
  });

  test("sanitizes invalid browser message handler output for user-visible replies", () => {
    const dir = createTempDir("pi-agent-queue-runtime-handler-");
    tempDirs.push(dir);
    const handlerPath = join(dir, "handler.js");
    writeFileSync(handlerPath, 'process.stdout.write(`owner secret actor_owner raw stdout\\n`);', "utf-8");

    process.env.PI_SITE_BROWSER_MESSAGE_HANDLER = handlerPath;

    let error: unknown;
    try {
      runBrowserMessageHandler(makeMessage({
        role: "user",
        source: "browser",
        content: "I want to track my weight daily",
      }));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeTruthy();
    expect(replyTextForRuntimeError(error)).toBe("I couldn't process that request right now. Please try again.");
    expect(replyTextForRuntimeError(error)).not.toContain("actor_owner");
  });

  test("times out hung browser message handlers and returns a safe reply", () => {
    const dir = createTempDir("pi-agent-queue-runtime-handler-");
    tempDirs.push(dir);
    const handlerPath = join(dir, "handler.js");
    writeFileSync(handlerPath, 'setTimeout(() => {}, 5000);', "utf-8");

    process.env.PI_SITE_BROWSER_MESSAGE_HANDLER = handlerPath;
    process.env.PI_SITE_BROWSER_MESSAGE_HANDLER_TIMEOUT_MS = "50";

    let error: unknown;
    try {
      runBrowserMessageHandler(makeMessage({
        role: "user",
        source: "browser",
        content: "I want to track my weight daily",
      }));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeTruthy();
    expect(replyTextForRuntimeError(error)).toBe("I couldn't process that request right now. Please try again.");
  });

  test("keeps same-route turns serialized while the active route is still in flight", async () => {
    const files = configureQueueRuntimeEnv();
    const first = makeMessage({ id: "msg_same_1", role: "user", source: "browser", content: "first" });
    const second = makeMessage({ id: "msg_same_2", role: "user", source: "browser", content: "second" });
    writeFileSync(files.inboxFile, `${JSON.stringify([first, second], null, 2)}\n`, "utf-8");

    const firstReply = createDeferred<string>();
    const secondReply = createDeferred<string>();
    const started: string[] = [];

    setMessageProcessorForTest(async (message) => {
      started.push(message.id);
      if (message.id === first.id) return await firstReply.promise;
      if (message.id === second.id) return await secondReply.promise;
      throw new Error(`unexpected message ${message.id}`);
    });

    await processInboxForTest();

    expect(started).toEqual([first.id]);
    expect(readMessages(files.inboxFile).map((message) => message.id)).toEqual([second.id]);

    firstReply.resolve("first reply");
    await waitFor(() => started.includes(second.id));
    expect(readMessages(files.repliesFile).map((message) => message.content)).toEqual(["first reply"]);

    secondReply.resolve("second reply");
    await waitFor(() => readMessages(files.repliesFile).length === 2);
    expect(readMessages(files.repliesFile).map((message) => message.content)).toEqual(["first reply", "second reply"]);
  });

  test("does not let a stalled automation route block a default human route", async () => {
    const files = configureQueueRuntimeEnv({ actionAgents: { "maintenance-pulse": "steward-pulse" } });
    const maintenance = makeMessage({ id: "msg_auto_1" });
    const owner = makeMessage({
      id: "msg_owner_1",
      role: "user",
      source: "browser",
      content: "I want to track my weight daily",
      actorId: "actor_owner",
      actorLogin: "rhnvrm@github",
    });
    writeFileSync(files.inboxFile, `${JSON.stringify([maintenance, owner], null, 2)}\n`, "utf-8");

    const maintenanceReply = createDeferred<string>();
    const started: string[] = [];

    setMessageProcessorForTest(async (message, routing) => {
      started.push(`${message.id}:${routing.agentName}`);
      if (routing.agentName === "steward-pulse") return await maintenanceReply.promise;
      if (routing.agentName === "steward") return "owner reply";
      throw new Error(`unexpected route ${routing.agentName}`);
    });

    await processInboxForTest();

    await waitFor(() => readMessages(files.repliesFile).some((message) => message.content === "owner reply"));
    expect(started).toEqual(["msg_auto_1:steward-pulse", "msg_owner_1:steward"]);
    expect(readMessages(files.repliesFile).map((message) => message.content)).toEqual(["owner reply"]);

    maintenanceReply.resolve("maintenance reply");
    await waitFor(() => readMessages(files.repliesFile).length === 2);
    expect(readMessages(files.repliesFile).map((message) => message.content)).toEqual(["owner reply", "maintenance reply"]);
  });

  test("surfaces persistent agent session errors immediately as a safe reply", async () => {
    const files = configureQueueRuntimeEnv();
    const userMessage = makeMessage({
      id: "msg_err_1",
      role: "user",
      source: "browser",
      content: "hello",
    });
    writeFileSync(files.inboxFile, `${JSON.stringify([userMessage], null, 2)}\n`, "utf-8");

    const sessionPath = join(process.env.PI_SITE_STATE_DIR!, "pi-agent-session.jsonl");
    setRuntimeBackendForTest({
      type: "tmux",
      hasSession: async () => true,
      sendText: async () => {
        writeFileSync(sessionPath, `${JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [],
            stopReason: "error",
            errorMessage: "No API key for provider: openai-codex",
          },
        })}\n`, "utf-8");
      },
      sendKey: async () => {},
    } as unknown as ProcessBackend);

    await processInboxForTest();
    await waitFor(() => readMessages(files.repliesFile).length === 1);

    expect(readMessages(files.repliesFile).map((message) => message.content)).toEqual([
      "I couldn't process that request right now. Please try again.",
    ]);
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

afterEach(() => {
  setRuntimeBackendForTest(undefined);
  setMessageProcessorForTest(undefined);
  resetQueueRuntimeForTest();
  process.env.PI_SITE_AGENT_NAME = originalEnv.PI_SITE_AGENT_NAME;
  process.env.PI_SITE_AUTOMATION_AGENT_NAME = originalEnv.PI_SITE_AUTOMATION_AGENT_NAME;
  process.env.PI_SITE_AUTOMATION_ACTIONS = originalEnv.PI_SITE_AUTOMATION_ACTIONS;
  process.env.PI_SITE_ACTION_AGENTS = originalEnv.PI_SITE_ACTION_AGENTS;
  process.env.PI_SITE_STATE_DIR = originalEnv.PI_SITE_STATE_DIR;
  process.env.PI_SITE_INBOX_FILE = originalEnv.PI_SITE_INBOX_FILE;
  process.env.PI_SITE_OUTBOX_FILE = originalEnv.PI_SITE_OUTBOX_FILE;
  process.env.PI_SITE_REPLIES_FILE = originalEnv.PI_SITE_REPLIES_FILE;
  process.env.PI_SITE_SESSION_NAME = originalEnv.PI_SITE_SESSION_NAME;
  process.env.PI_SITE_AGENT_SESSION_PREFIX = originalEnv.PI_SITE_AGENT_SESSION_PREFIX;
  process.env.PI_SITE_BROWSER_MESSAGE_HANDLER = originalEnv.PI_SITE_BROWSER_MESSAGE_HANDLER;
  process.env.PI_SITE_BROWSER_MESSAGE_HANDLER_TIMEOUT_MS = originalEnv.PI_SITE_BROWSER_MESSAGE_HANDLER_TIMEOUT_MS;
});

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});
