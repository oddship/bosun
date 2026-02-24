import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { discoverAgents, findAgentFile, loadAgent } from "../extensions/agents.js";

describe("discoverAgents", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agents-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no agents directory exists", () => {
    const agents = discoverAgents(tmpDir, []);
    expect(agents).toEqual([]);
  });

  it("discovers agents from .pi/agents/", () => {
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "bosun.md"), "---\nname: bosun\n---\nHello");
    fs.writeFileSync(path.join(agentsDir, "lite.md"), "---\nname: lite\n---\nFast");

    const agents = discoverAgents(tmpDir, []);
    expect(agents).toContain("bosun");
    expect(agents).toContain("lite");
    expect(agents).toHaveLength(2);
  });

  it("discovers agents from extra agentPaths", () => {
    const extraDir = path.join(tmpDir, "extra", "agents");
    fs.mkdirSync(extraDir, { recursive: true });
    fs.writeFileSync(path.join(extraDir, "q.md"), "---\nname: q\n---\nQ agent");

    const agents = discoverAgents(tmpDir, [path.join(tmpDir, "extra", "agents")]);
    expect(agents).toContain("q");
  });

  it("deduplicates: standard path wins over extra paths", () => {
    const standardDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(standardDir, { recursive: true });
    fs.writeFileSync(path.join(standardDir, "agent.md"), "standard version");

    const extraDir = path.join(tmpDir, "extra");
    fs.mkdirSync(extraDir, { recursive: true });
    fs.writeFileSync(path.join(extraDir, "agent.md"), "extra version");

    const agents = discoverAgents(tmpDir, [extraDir]);
    expect(agents.filter((a) => a === "agent")).toHaveLength(1);
  });

  it("ignores non-.md files", () => {
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "bosun.md"), "agent");
    fs.writeFileSync(path.join(agentsDir, "notes.txt"), "not an agent");
    fs.writeFileSync(path.join(agentsDir, ".gitkeep"), "");

    const agents = discoverAgents(tmpDir, []);
    expect(agents).toEqual(["bosun"]);
  });
});

describe("findAgentFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agents-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when agent not found", () => {
    expect(findAgentFile(tmpDir, [], "nonexistent")).toBeNull();
  });

  it("finds agent in standard .pi/agents/ path", () => {
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "bosun.md"), "agent content");

    const file = findAgentFile(tmpDir, [], "bosun");
    expect(file).toBe(path.join(agentsDir, "bosun.md"));
  });

  it("finds agent in extra agentPaths", () => {
    const extraDir = path.join(tmpDir, "pkg", "agents");
    fs.mkdirSync(extraDir, { recursive: true });
    fs.writeFileSync(path.join(extraDir, "q.md"), "q agent");

    const file = findAgentFile(tmpDir, [extraDir], "q");
    expect(file).toBe(path.join(extraDir, "q.md"));
  });

  it("prefers standard path over extra paths", () => {
    const standardDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(standardDir, { recursive: true });
    fs.writeFileSync(path.join(standardDir, "agent.md"), "standard");

    const extraDir = path.join(tmpDir, "extra");
    fs.mkdirSync(extraDir, { recursive: true });
    fs.writeFileSync(path.join(extraDir, "agent.md"), "extra");

    const file = findAgentFile(tmpDir, [extraDir], "agent");
    expect(file).toBe(path.join(standardDir, "agent.md"));
  });

  it("resolves relative agentPaths against cwd", () => {
    const extraDir = path.join(tmpDir, "node_modules", "pi-q", "agents");
    fs.mkdirSync(extraDir, { recursive: true });
    fs.writeFileSync(path.join(extraDir, "q.md"), "q agent");

    const file = findAgentFile(tmpDir, ["node_modules/pi-q/agents"], "q");
    expect(file).toBe(path.join(extraDir, "q.md"));
  });
});

describe("loadAgent", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agents-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses full frontmatter", () => {
    const file = path.join(tmpDir, "bosun.md");
    fs.writeFileSync(
      file,
      [
        "---",
        "name: bosun",
        "description: Main orchestrator",
        "model: high",
        "thinking: medium",
        "tools: read, bash, write, edit",
        "extensions: pi-agents, pi-tmux, pi-mesh",
        "skill: git, context-management",
        "---",
        "",
        "You are Bosun, the main orchestrator.",
        "",
        "## Your Role",
        "Coordinate tasks.",
      ].join("\n"),
    );

    const agent = loadAgent(file);
    expect(agent.name).toBe("bosun");
    expect(agent.description).toBe("Main orchestrator");
    expect(agent.model).toBe("high");
    expect(agent.thinking).toBe("medium");
    expect(agent.tools).toBe("read, bash, write, edit");
    expect(agent.extensions).toBe("pi-agents, pi-tmux, pi-mesh");
    expect(agent.skill).toBe("git, context-management");
    expect(agent.body).toContain("You are Bosun");
    expect(agent.body).toContain("## Your Role");
  });

  it("defaults name to filename when not in frontmatter", () => {
    const file = path.join(tmpDir, "lite.md");
    fs.writeFileSync(file, "---\ndescription: Fast helper\n---\nFast agent.");

    const agent = loadAgent(file);
    expect(agent.name).toBe("lite");
  });

  it("handles file with no frontmatter", () => {
    const file = path.join(tmpDir, "plain.md");
    fs.writeFileSync(file, "Just a plain markdown file with no frontmatter.");

    const agent = loadAgent(file);
    expect(agent.name).toBe("plain");
    expect(agent.body).toBe("Just a plain markdown file with no frontmatter.");
    expect(agent.model).toBeUndefined();
    expect(agent.extensions).toBeUndefined();
  });

  it("handles empty frontmatter", () => {
    const file = path.join(tmpDir, "empty.md");
    fs.writeFileSync(file, "---\n---\nBody only.");

    const agent = loadAgent(file);
    expect(agent.name).toBe("empty");
    expect(agent.body).toBe("Body only.");
  });

  it("preserves raw frontmatter for extra fields", () => {
    const file = path.join(tmpDir, "custom.md");
    fs.writeFileSync(
      file,
      "---\nname: custom\ncustomField: hello\ndefaultProgress: true\n---\nBody.",
    );

    const agent = loadAgent(file);
    expect(agent.frontmatter.customField).toBe("hello");
    expect(agent.frontmatter.defaultProgress).toBe(true);
  });
});
