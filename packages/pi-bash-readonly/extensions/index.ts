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
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { writeFileSync, unlinkSync } from "node:fs";
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

  pi.on("tool_call", async (event) => {
    if (!hasBwrap) return;
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
