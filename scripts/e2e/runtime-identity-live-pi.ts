import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TmuxHarness, ensureExists, worktreeRoot } from "./harness";

interface CheckResult {
  name: string;
  details: string;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function run(): Promise<void> {
  const root = worktreeRoot();
  const harness = new TmuxHarness({ root, name: "runtime-identity-live-pi" });
  const meshDir = mkdtempSync(join(tmpdir(), "bosun-mesh-e2e-"));
  const results: CheckResult[] = [];

  ensureExists(join(root, ".bosun-home", ".pi", "agent", "auth.json"), "Missing auth.json for live Pi E2E");
  ensureExists(join(root, "config.toml"), "Missing config.toml for live Pi E2E");

  try {
    await harness.startSession("livepi", "focus", "bash");
    await harness.newWindow("livepi", "agentwin", "bash");
    await harness.selectWindow("livepi:1");

    const pane = await harness.paneId("livepi:2");
    const newName = "live-pi-renamed";
    const prompt = [
      "Use the mesh_manage tool exactly once.",
      `Rename yourself to ${newName}.`,
      'Do not ask questions.',
      'After the tool succeeds, reply with exactly RENAMED.',
    ].join(" ");

    const command = [
      `cd ${shellEscape(root)}`,
      `export BOSUN_ROOT=${shellEscape(root)}`,
      `export BOSUN_WORKSPACE=${shellEscape(join(root, "workspace"))}`,
      `export PI_CODING_AGENT_DIR=${shellEscape(join(root, ".bosun-home", ".pi", "agent"))}`,
      `export PI_AGENT=bosun`,
      `export PI_AGENT_NAME=livepi-agent`,
      `export PI_MESH_DIR=${shellEscape(meshDir)}`,
      `export TMUX=${shellEscape(`${harness.socket},999,1`)}`,
      `export TMUX_PANE=${shellEscape(pane)}`,
      `pi ${shellEscape(prompt)}`,
    ].join(" && ");

    await harness.sendKeys("livepi:2", command);

    await harness.waitFor(async () => {
      const windows = await harness.listWindows("livepi");
      return windows.some((w) => w.includes(`2:${newName}`));
    }, 90000, 500);

    const windowsAfterRename = await harness.listWindows("livepi");
    const renamedSecond = windowsAfterRename.some((w) => w === `2:${newName}:0`);
    const untouchedFirst = windowsAfterRename.some((w) => w === "1:focus:1");
    if (!renamedSecond || !untouchedFirst) {
      throw new Error(`live Pi rename targeted wrong window: ${windowsAfterRename.join(", ")}`);
    }
    results.push({
      name: "live Pi rename updates only originating window",
      details: windowsAfterRename.join(", "),
    });

    await harness.waitFor(async () => {
      try {
        const registry = readFileSync(join(meshDir, "registry", `${newName}.json`), "utf-8");
        return registry.includes(`"name": "${newName}"`);
      } catch {
        return false;
      }
    }, 15000, 250);

    const registryText = readFileSync(join(meshDir, "registry", `${newName}.json`), "utf-8");
    if (!registryText.includes(`"name": "${newName}"`)) {
      throw new Error(`mesh registry did not converge to ${newName}`);
    }
    results.push({
      name: "live Pi rename updates mesh registry",
      details: `${newName}.json present in ${join(meshDir, "registry")}`,
    });

    await harness.waitFor(async () => {
      const pane = await harness.capturePane("livepi:2", 80);
      return pane.includes("RENAMED");
    }, 15000, 250);

    results.push({
      name: "live Pi flow completed after tool call",
      details: "pane output contained RENAMED",
    });

    console.log("E2E live Pi runtime identity checks passed:\n");
    for (const result of results) {
      console.log(`- ${result.name}: ${result.details}`);
    }
  } finally {
    await harness.cleanup();
  }
}

await run();
