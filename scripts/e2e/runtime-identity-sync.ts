import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TmuxHarness, fixturePath, worktreeRoot } from "./harness";

interface CheckResult {
  name: string;
  details: string;
}

async function run(): Promise<void> {
  const root = worktreeRoot();
  const harness = new TmuxHarness({ root, name: "runtime-identity-sync" });
  const outDir = mkdtempSync(join(tmpdir(), "bosun-e2e-"));
  const results: CheckResult[] = [];

  try {
    await harness.startSession("identity", "one", "bash");
    await harness.newWindow("identity", "two", "bash");
    await harness.selectWindow("identity:1");

    const paneTwo = await harness.paneId("identity:2");
    const paneOne = await harness.paneId("identity:1");

    const renameFixture = fixturePath("rename-own-window.ts");
    const printFixture = fixturePath("print-own-window.ts");

    await harness.sendKeys(
      "identity:2",
      `TMUX=${harness.socket},999,1 TMUX_PANE=${paneTwo} bun ${renameFixture} two-targeted`,
    );

    await harness.waitFor(async () => {
      const windows = await harness.listWindows("identity");
      return windows.some((w) => w.includes("2:two-targeted"));
    });

    const windowsAfterRename = await harness.listWindows("identity");
    // These assertions rely on bosun's tmux.conf setting `base-index 1` and
    // the harness loading that config when it starts the isolated server.
    const renamedSecond = windowsAfterRename.some((w) => w === "2:two-targeted:0");
    const untouchedFirst = windowsAfterRename.some((w) => w === "1:one:1");
    if (!renamedSecond || !untouchedFirst) {
      throw new Error(`targeted rename failed: ${windowsAfterRename.join(", ")}`);
    }
    results.push({
      name: "rename targets agent pane window",
      details: windowsAfterRename.join(", "),
    });

    const outOne = join(outDir, "one.txt");
    const outTwo = join(outDir, "two.txt");

    await harness.sendKeys(
      "identity:1",
      `TMUX=${harness.socket},999,1 TMUX_PANE=${paneOne} bun ${printFixture} > ${outOne}`,
    );
    await harness.sendKeys(
      "identity:2",
      `TMUX=${harness.socket},999,1 TMUX_PANE=${paneTwo} bun ${printFixture} > ${outTwo}`,
    );

    await harness.waitFor(async () => {
      try {
        return readFileSync(outOne, "utf-8").trim().length > 0 && readFileSync(outTwo, "utf-8").trim().length > 0;
      } catch {
        return false;
      }
    });

    const windowOneName = readFileSync(outOne, "utf-8").trim();
    const windowTwoName = readFileSync(outTwo, "utf-8").trim();
    if (windowOneName !== "one") {
      throw new Error(`expected pane one to resolve window 'one', got '${windowOneName}'`);
    }
    if (windowTwoName !== "two-targeted") {
      throw new Error(`expected pane two to resolve window 'two-targeted', got '${windowTwoName}'`);
    }
    results.push({
      name: "window lookup uses pane target",
      details: `pane1=${windowOneName}, pane2=${windowTwoName}`,
    });

    console.log("E2E runtime identity sync checks passed:\n");
    for (const result of results) {
      console.log(`- ${result.name}: ${result.details}`);
    }
  } finally {
    await harness.cleanup();
  }
}

await run();
