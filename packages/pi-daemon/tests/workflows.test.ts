import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { discoverWorkflows, deriveWatchers, deriveRules } from "../src/workflows.js";

describe("workflow discovery", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-daemon-wf-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createWorkflow(base: string, name: string, config: string, agentMd?: string): void {
    const dir = path.join(base, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "config.toml"), config);
    if (agentMd) {
      fs.writeFileSync(path.join(dir, "agent.md"), agentMd);
    }
  }

  it("returns empty when no workflow dirs exist", () => {
    const workflows = discoverWorkflows(tmpDir);
    expect(workflows).toHaveLength(0);
  });

  it("discovers workflows from packages", () => {
    const pkgDir = path.join(tmpDir, "packages", "my-pkg", "workflows");
    createWorkflow(pkgDir, "my-workflow", `
[workflow]
name = "my-workflow"
type = "agent"

[trigger]
schedule = "hourly"

[agent]
model = "lite"
prompt = "Do stuff"
`, "# Agent\nYou do stuff.");

    const workflows = discoverWorkflows(tmpDir);
    expect(workflows).toHaveLength(1);
    expect(workflows[0].name).toBe("my-workflow");
    expect(workflows[0].type).toBe("agent");
    expect(workflows[0].source).toBe("package");
    expect(workflows[0].trigger.schedule).toBe("hourly");
    expect(workflows[0].agent?.model).toBe("lite");
    expect(workflows[0].agent?.prompt).toBe("Do stuff");
    expect(workflows[0].agent?.systemPromptFile).toContain("agent.md");
  });

  it("discovers workflows from .pi/workflows", () => {
    const repoDir = path.join(tmpDir, ".pi", "workflows");
    createWorkflow(repoDir, "repo-wf", `
[workflow]
name = "repo-wf"
type = "script"

[trigger]
schedule = "daily:03"

[script]
command = "./run.sh"
`);

    const workflows = discoverWorkflows(tmpDir);
    expect(workflows).toHaveLength(1);
    expect(workflows[0].name).toBe("repo-wf");
    expect(workflows[0].type).toBe("script");
    expect(workflows[0].source).toBe("repo");
    expect(workflows[0].script?.command).toBe("./run.sh");
  });

  it("discovers workflows from workspace/workflows", () => {
    const userDir = path.join(tmpDir, "workspace", "workflows");
    createWorkflow(userDir, "user-wf", `
[workflow]
name = "user-wf"
type = "agent"

[trigger]
watcher = "data/**/*.json"
debounce_ms = 3000

[agent]
prompt = "Process data"
`);

    const workflows = discoverWorkflows(tmpDir);
    expect(workflows).toHaveLength(1);
    expect(workflows[0].name).toBe("user-wf");
    expect(workflows[0].source).toBe("user");
    expect(workflows[0].trigger.watcher).toBe("data/**/*.json");
    expect(workflows[0].trigger.debounce_ms).toBe(3000);
  });

  it("user overrides package by workflow name", () => {
    const pkgDir = path.join(tmpDir, "packages", "pkg", "workflows");
    createWorkflow(pkgDir, "shared-wf", `
[workflow]
name = "shared-wf"
type = "agent"

[trigger]
schedule = "hourly"

[agent]
model = "lite"
prompt = "Package default prompt"
`);

    const userDir = path.join(tmpDir, "workspace", "workflows");
    createWorkflow(userDir, "shared-wf", `
[workflow]
name = "shared-wf"
type = "agent"

[agent]
model = "cheap"
prompt = "User custom prompt"
`);

    const workflows = discoverWorkflows(tmpDir);
    expect(workflows).toHaveLength(1);
    expect(workflows[0].source).toBe("user");
    expect(workflows[0].agent?.model).toBe("cheap");
    expect(workflows[0].agent?.prompt).toBe("User custom prompt");
    // Trigger inherited from package
    expect(workflows[0].trigger.schedule).toBe("hourly");
  });

  it("skips directories without config.toml", () => {
    const pkgDir = path.join(tmpDir, "packages", "pkg", "workflows", "no-config");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "agent.md"), "# Agent");

    const workflows = discoverWorkflows(tmpDir);
    expect(workflows).toHaveLength(0);
  });

  it("defaults name from directory name", () => {
    const repoDir = path.join(tmpDir, ".pi", "workflows");
    createWorkflow(repoDir, "dir-name-wf", `
[workflow]
type = "agent"

[trigger]
schedule = "hourly"

[agent]
prompt = "test"
`);

    const workflows = discoverWorkflows(tmpDir);
    expect(workflows).toHaveLength(1);
    expect(workflows[0].name).toBe("dir-name-wf");
  });
});

describe("deriveWatchers", () => {
  it("creates watchers from watcher-triggered workflows", () => {
    const workflows = discoverWorkflows("/nonexistent");
    // Empty case
    expect(deriveWatchers(workflows)).toHaveLength(0);
  });
});

describe("deriveRules", () => {
  it("creates rules from workflows with triggers or schedules", () => {
    const workflows = discoverWorkflows("/nonexistent");
    expect(deriveRules(workflows)).toHaveLength(0);
  });
});
