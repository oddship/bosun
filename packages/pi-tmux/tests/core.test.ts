import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  isInTmux,
  getTmuxSocket,
  getTmuxPane,
  getTmuxSession,
  getTmuxSessionSync,
  getTmuxContext,
  listWindows,
  windowExists,
  getWindowName,
} from "../core.js";

// =============================================================================
// Environment detection (always testable, no tmux calls)
// =============================================================================

describe("isInTmux", () => {
  const origTmux = process.env.TMUX;

  afterEach(() => {
    if (origTmux !== undefined) process.env.TMUX = origTmux;
    else delete process.env.TMUX;
  });

  it("returns true when $TMUX is set", () => {
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
    expect(isInTmux()).toBe(true);
  });

  it("returns false when $TMUX is unset", () => {
    delete process.env.TMUX;
    expect(isInTmux()).toBe(false);
  });

  it("returns false when $TMUX is empty", () => {
    process.env.TMUX = "";
    expect(isInTmux()).toBe(false);
  });
});

describe("getTmuxSocket", () => {
  const origTmux = process.env.TMUX;

  afterEach(() => {
    if (origTmux !== undefined) process.env.TMUX = origTmux;
    else delete process.env.TMUX;
  });

  it("extracts socket path from $TMUX", () => {
    process.env.TMUX = "/run/user/1000/bosun-tmux/bosun-abc123.sock,54321,0";
    expect(getTmuxSocket()).toBe("/run/user/1000/bosun-tmux/bosun-abc123.sock");
  });

  it("returns null when $TMUX is unset", () => {
    delete process.env.TMUX;
    expect(getTmuxSocket()).toBeNull();
  });

  it("handles $TMUX with just a socket path", () => {
    process.env.TMUX = "/tmp/tmux.sock";
    expect(getTmuxSocket()).toBe("/tmp/tmux.sock");
  });
});

describe("getTmuxPane", () => {
  const origPane = process.env.TMUX_PANE;

  afterEach(() => {
    if (origPane !== undefined) process.env.TMUX_PANE = origPane;
    else delete process.env.TMUX_PANE;
  });

  it("returns $TMUX_PANE value", () => {
    process.env.TMUX_PANE = "%5";
    expect(getTmuxPane()).toBe("%5");
  });

  it("returns null when unset", () => {
    delete process.env.TMUX_PANE;
    expect(getTmuxPane()).toBeNull();
  });
});

// =============================================================================
// Functions that call tmux (skip when not in tmux)
// =============================================================================

const inTmux = !!process.env.TMUX;

describe.skipIf(!inTmux)("getTmuxSession (live tmux)", () => {
  it("returns a non-empty session name", async () => {
    const session = await getTmuxSession();
    expect(session).toBeTruthy();
    expect(typeof session).toBe("string");
  });
});

describe.skipIf(!inTmux)("getTmuxSessionSync (live tmux)", () => {
  it("returns a non-empty session name", () => {
    const session = getTmuxSessionSync();
    expect(session).toBeTruthy();
    expect(typeof session).toBe("string");
  });

  it("matches async variant", async () => {
    const sync = getTmuxSessionSync();
    const async_ = await getTmuxSession();
    expect(sync).toBe(async_);
  });
});

describe.skipIf(!inTmux)("getTmuxContext (live tmux)", () => {
  it("returns socket, session, and pane", async () => {
    const ctx = await getTmuxContext();
    expect(ctx.socket).toBeTruthy();
    expect(ctx.session).toBeTruthy();
    // pane may be null in some test environments
    expect(typeof ctx.socket).toBe("string");
    expect(typeof ctx.session).toBe("string");
  });
});

describe.skipIf(!inTmux)("listWindows (live tmux)", () => {
  it("returns at least one window", async () => {
    const windows = await listWindows();
    expect(windows.length).toBeGreaterThanOrEqual(1);
  });

  it("returns strings", async () => {
    const windows = await listWindows();
    for (const w of windows) {
      expect(typeof w).toBe("string");
    }
  });
});

describe.skipIf(!inTmux)("windowExists (live tmux)", () => {
  it("returns true for the current window", async () => {
    const name = await getWindowName();
    if (name) {
      expect(windowExists(name)).toBe(true);
    }
  });

  it("returns false for a nonexistent window", () => {
    expect(windowExists("__nonexistent_window_test_12345__")).toBe(false);
  });
});

describe.skipIf(!inTmux)("getWindowName (live tmux)", () => {
  it("returns a non-empty string", async () => {
    const name = await getWindowName();
    expect(name).toBeTruthy();
    expect(typeof name).toBe("string");
  });
});
