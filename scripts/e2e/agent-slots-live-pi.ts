/**
 * E2E: Verify agents load with rendered slots from pi-bosun package.
 *
 * Starts a real Pi process with PI_AGENT=bosun, sends a prompt that asks
 * the agent to describe its own capabilities, and checks the response
 * includes content from rendered slots (delegation, workspace, memory).
 *
 * Requires: auth.json, config.toml
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TmuxHarness, ensureExists, worktreeRoot } from "./harness";

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function run(): Promise<void> {
  const root = worktreeRoot();
  const harness = new TmuxHarness({ root, name: "agent-slots-e2e" });
  const meshDir = mkdtempSync(join(tmpdir(), "bosun-slots-e2e-"));

  ensureExists(join(root, ".bosun-home", ".pi", "agent", "auth.json"), "Missing auth.json for live Pi E2E");
  ensureExists(join(root, "config.toml"), "Missing config.toml for live Pi E2E");

  // Ensure init has been run (agents.json needs correct agentPaths)
  ensureExists(join(root, ".pi", "agents.json"), "Missing .pi/agents.json — run 'just init' first");

  try {
    await harness.startSession("slots", "focus", "bash");
    await harness.newWindow("slots", "agent", "bash");

    const pane = await harness.paneId("slots:2");

    // Ask the agent to output specific markers that would only appear
    // if slots were rendered into the system prompt.
    // The delegation slot mentions "spawn_agent", workspace slot mentions
    // "$BOSUN_WORKSPACE", memory guidance mentions "memory" tool.
    const prompt = [
      "Without using any tools, answer these three yes/no questions based on your system prompt:",
      "1. Do your instructions mention spawn_agent for delegation?",
      "2. Do your instructions mention BOSUN_WORKSPACE or workspace/?",
      "3. Do your instructions mention a memory tool?",
      "Reply with exactly three lines: Q1: yes/no, Q2: yes/no, Q3: yes/no.",
      "Then on the next line write SLOTS_CHECK_DONE.",
    ].join(" ");

    const command = [
      `cd ${shellEscape(root)}`,
      `export BOSUN_ROOT=${shellEscape(root)}`,
      `export BOSUN_WORKSPACE=${shellEscape(join(root, "workspace"))}`,
      `export PI_CODING_AGENT_DIR=${shellEscape(join(root, ".bosun-home", ".pi", "agent"))}`,
      `export PI_AGENT=bosun`,
      `export PI_AGENT_NAME=slots-check`,
      `export PI_MESH_DIR=${shellEscape(meshDir)}`,
      `export TMUX=${shellEscape(`${harness.socket},999,1`)}`,
      `export TMUX_PANE=${shellEscape(pane)}`,
      `pi ${shellEscape(prompt)}`,
    ].join(" && ");

    await harness.sendKeys("slots:2", command);

    // Wait for the agent to respond
    await harness.waitFor(async () => {
      const output = await harness.capturePane("slots:2", 100);
      return output.includes("SLOTS_CHECK_DONE");
    }, 120000, 1000);

    const output = await harness.capturePane("slots:2", 100);

    // Check results
    const results: { name: string; details: string }[] = [];
    const lines = output.toLowerCase();

    const q1 = lines.includes("q1: yes");
    const q2 = lines.includes("q2: yes");
    const q3 = lines.includes("q3: yes");

    if (!q1) throw new Error("Delegation slot not rendered — agent doesn't know about spawn_agent");
    results.push({ name: "delegation slot rendered", details: "agent knows about spawn_agent" });

    if (!q2) throw new Error("Workspace slot not rendered — agent doesn't know about BOSUN_WORKSPACE");
    results.push({ name: "workspace slot rendered", details: "agent knows about workspace/" });

    if (!q3) throw new Error("Memory slot not rendered — agent doesn't know about memory tool");
    results.push({ name: "memory slot rendered", details: "agent knows about memory tool" });

    console.log("E2E agent slot rendering checks passed:\n");
    for (const result of results) {
      console.log(`- ${result.name}: ${result.details}`);
    }
  } finally {
    await harness.cleanup();
  }
}

await run();
