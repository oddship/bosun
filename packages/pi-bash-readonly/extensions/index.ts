/**
 * pi-bash-readonly — Kernel-enforced read-only bash via nested bwrap.
 *
 * Intercepts bash tool calls and wraps commands in a bwrap sub-sandbox
 * where the entire filesystem is mounted read-only (`--ro-bind / /`),
 * except for $BOSUN_WORKSPACE which remains writable (agents need to
 * write reviews, reports, etc. there).
 *
 * This is a hard security boundary — no userspace bypass is possible.
 * Unlike regex-based command filtering, this catches writes from any
 * language runtime (python, perl, dd, etc.).
 *
 * Agents opt in by adding `pi-bash-readonly` to their extensions list.
 *
 * Behavior depends on the agent's tool set:
 * - Agents WITHOUT edit/write (scout, review, oracle, verify):
 *   Always-on bwrap, no toggle. These agents are read-only by design.
 * - Agents WITH edit/write (bosun, lite):
 *   `/readonly` command toggles bwrap wrapping on/off. Defaults to off.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

/** Shell-escape a string by wrapping in single quotes. */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export default function (pi: ExtensionAPI) {
  const workspace = process.env.BOSUN_WORKSPACE || join(process.cwd(), "workspace");
  const cwd = process.cwd();

  // Check if bwrap is available at load time
  let hasBwrap = true;
  try {
    execSync("which bwrap", { stdio: "ignore" });
  } catch {
    hasBwrap = false;
    // eslint-disable-next-line no-console
    console.warn("[pi-bash-readonly] bwrap not found — falling back to unrestricted bash");
  }

  // Determines whether bwrap wrapping is active.
  // For read-only agents (no edit/write): always true, no toggle.
  // For write-capable agents: toggled via /readonly command, starts off.
  let readOnly = true;
  let isWriteCapableAgent = false;

  pi.on("session_start", async (_event, _ctx) => {
    const activeTools = pi.getActiveTools();
    isWriteCapableAgent = activeTools.includes("edit") || activeTools.includes("write");

    if (isWriteCapableAgent) {
      // Write-capable agents start with readonly off — they opted into
      // having edit/write and shouldn't be surprised by bwrap failures.
      readOnly = false;
    }
  });

  // Only register /readonly for agents that have edit/write tools.
  // Read-only agents (scout, review, etc.) get permanent bwrap with no escape.
  pi.registerCommand("readonly", {
    description: "Toggle read-only bash (bwrap sandbox)",
    handler: async (_args, ctx) => {
      if (!isWriteCapableAgent) {
        ctx.ui.notify("This agent is read-only by design — toggle not available", "warning");
        return;
      }
      if (!hasBwrap) {
        ctx.ui.notify("bwrap not found — read-only mode unavailable", "error");
        return;
      }
      readOnly = !readOnly;
      ctx.ui.notify(readOnly ? "🔒 bash: read-only (bwrap)" : "🔓 bash: full access", "info");
      ctx.ui.setStatus("bash-ro", readOnly ? "🔒 ro" : "");
    },
  });

  pi.on("tool_call", async (event) => {
    if (!hasBwrap || !readOnly) return;
    if (!isToolCallEventType("bash", event)) return;

    const originalCommand = event.input.command;

    // Write the original command to a temp file to avoid nested shell
    // quoting issues across 4 layers (pi → bash -c → bwrap → bash).
    const tmpFile = `/tmp/pi-bash-ro-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`;
    writeFileSync(tmpFile, originalCommand, { mode: 0o755 });

    // Build the bwrap command:
    //   --ro-bind / /         entire filesystem read-only (kernel-enforced)
    //   --dev /dev            device nodes (needed for /dev/null, /dev/urandom, etc.)
    //   --proc /proc          proc filesystem (needed for process info)
    //   --tmpfs /tmp          writable scratch space (sort, awk temp files, etc.)
    //   --ro-bind <tmpFile>   mount the command script inside bwrap's /tmp
    //   --bind workspace      workspace dir writable (agents write reports there)
    //   --chdir <cwd>         preserve working directory
    const bwrapCmd = [
      "bwrap",
      "--ro-bind", "/", "/",
      "--dev", "/dev",
      "--proc", "/proc",
      "--tmpfs", "/tmp",
      "--ro-bind", tmpFile, tmpFile,
      "--bind", shellEscape(workspace), shellEscape(workspace),
      "--chdir", shellEscape(cwd),
      "bash", tmpFile,
    ].join(" ");

    // Run bwrap, capture exit code, clean up temp file regardless of outcome.
    // The cleanup runs in the OUTER shell (after bwrap exits) where /tmp is writable.
    event.input.command = `${bwrapCmd}; __exit=$?; rm -f ${tmpFile}; exit $__exit`;
  });
}
