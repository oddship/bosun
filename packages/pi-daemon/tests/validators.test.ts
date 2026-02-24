import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runValidators } from "../src/validators.js";
import type { WorkflowConfig } from "../src/workflows.js";

describe("validators", () => {
  let tmpDir: string;

  const mockWorkflow: WorkflowConfig = {
    name: "test-wf",
    description: "test",
    type: "agent",
    dir: "",
    source: "repo",
    trigger: {},
    retry: { max_attempts: 1, feedback: true },
    validators: {},
    timeout_minutes: 5,
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-daemon-val-"));
    mockWorkflow.dir = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes when validator file does not exist", async () => {
    const result = await runValidators("input", path.join(tmpDir, "nonexistent.ts"), {
      workflow: mockWorkflow,
      context: {},
      stdout: "",
      exitCode: 0,
    });
    expect(result.passed).toBe(true);
  });

  it("passes when validator exits 0", async () => {
    const script = path.join(tmpDir, "pass.ts");
    fs.writeFileSync(script, 'console.log("ok"); process.exit(0);');

    const result = await runValidators("input", script, {
      workflow: mockWorkflow,
      context: {},
      stdout: "",
      exitCode: 0,
    });
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("fails when validator exits 1", async () => {
    const script = path.join(tmpDir, "fail.ts");
    fs.writeFileSync(script, 'console.error("bad output"); process.exit(1);');

    const result = await runValidators("output", script, {
      workflow: mockWorkflow,
      context: {},
      stdout: "",
      exitCode: 0,
    });
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("bad output");
  });

  it("receives env vars", async () => {
    const script = path.join(tmpDir, "env-check.ts");
    fs.writeFileSync(
      script,
      `
if (process.env.WORKFLOW_NAME !== "test-wf") {
  console.error("wrong WORKFLOW_NAME: " + process.env.WORKFLOW_NAME);
  process.exit(1);
}
process.exit(0);
`,
    );

    const result = await runValidators("input", script, {
      workflow: mockWorkflow,
      context: {},
      stdout: "",
      exitCode: 0,
    });
    expect(result.passed).toBe(true);
  });

  it("output validator receives agent exit code in env", async () => {
    const script = path.join(tmpDir, "exit-check.ts");
    fs.writeFileSync(
      script,
      `
if (process.env.AGENT_EXIT_CODE !== "42") {
  console.error("wrong exit code: " + process.env.AGENT_EXIT_CODE);
  process.exit(1);
}
process.exit(0);
`,
    );

    const result = await runValidators("output", script, {
      workflow: mockWorkflow,
      context: {},
      stdout: "agent output",
      exitCode: 42,
    });
    expect(result.passed).toBe(true);
  });
});
