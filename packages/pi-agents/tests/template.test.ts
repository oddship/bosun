import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { processTemplate } from "../src/template.js";

describe("processTemplate", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-template-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns body unchanged when no template tags", () => {
    const body = "You are an agent.\n\n## Your Role\n\nDo things.";
    expect(processTemplate(body, { cwd: tmpDir })).toBe(body);
  });

  it("sets pi_memory=true when packages/pi-memory exists", () => {
    // Create a fake pi-memory package
    const pkgDir = path.join(tmpDir, "packages", "pi-memory");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "package.json"), '{"name":"pi-memory"}');

    const body = "Before.\n\n{{#if pi_memory}}\nMemory is available.\n{{/if}}\n\nAfter.";
    const result = processTemplate(body, { cwd: tmpDir });

    expect(result).toContain("Memory is available.");
    expect(result).toContain("Before.");
    expect(result).toContain("After.");
    expect(result).not.toContain("{{#if");
  });

  it("removes pi_memory block when package is absent", () => {
    // No packages/pi-memory directory
    const body = "Before.\n\n{{#if pi_memory}}\nMemory is available.\n{{/if}}\n\nAfter.";
    const result = processTemplate(body, { cwd: tmpDir });

    expect(result).not.toContain("Memory is available.");
    expect(result).toContain("Before.");
    expect(result).toContain("After.");
  });

  it("resolves partials from packages/<pkg>/slots/", () => {
    // Create package + slot
    const pkgDir = path.join(tmpDir, "packages", "pi-memory");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "package.json"), '{"name":"pi-memory"}');

    const slotsDir = path.join(pkgDir, "slots");
    fs.mkdirSync(slotsDir, { recursive: true });
    fs.writeFileSync(path.join(slotsDir, "memory_guidance.md"), "Use memory for fuzzy recall.");

    const body = "{{#if pi_memory}}\n{{> pi_memory/memory_guidance}}\n{{/if}}";
    const result = processTemplate(body, { cwd: tmpDir });

    expect(result).toContain("Use memory for fuzzy recall.");
  });

  it("resolves partials from .pi/slots/ override over packages/", () => {
    // Create package slot
    const pkgDir = path.join(tmpDir, "packages", "pi-memory");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "package.json"), '{"name":"pi-memory"}');
    const pkgSlots = path.join(pkgDir, "slots");
    fs.mkdirSync(pkgSlots, { recursive: true });
    fs.writeFileSync(path.join(pkgSlots, "memory_guidance.md"), "Package version.");

    // Create project override
    const overrideDir = path.join(tmpDir, ".pi", "slots", "pi-memory");
    fs.mkdirSync(overrideDir, { recursive: true });
    fs.writeFileSync(path.join(overrideDir, "memory_guidance.md"), "Override version.");

    const body = "{{#if pi_memory}}\n{{> pi_memory/memory_guidance}}\n{{/if}}";
    const result = processTemplate(body, { cwd: tmpDir });

    expect(result).toContain("Override version.");
    expect(result).not.toContain("Package version.");
  });

  it("renders empty string for missing partials", () => {
    const pkgDir = path.join(tmpDir, "packages", "pi-memory");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "package.json"), '{"name":"pi-memory"}');

    const body = "Before.\n{{#if pi_memory}}\n{{> pi_memory/nonexistent_slot}}\n{{/if}}\nAfter.";
    const result = processTemplate(body, { cwd: tmpDir });

    expect(result).toContain("Before.");
    expect(result).toContain("After.");
  });

  it("renders multiple slots in one conditional block", () => {
    const pkgDir = path.join(tmpDir, "packages", "pi-memory");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "package.json"), '{"name":"pi-memory"}');

    const slotsDir = path.join(pkgDir, "slots");
    fs.mkdirSync(slotsDir, { recursive: true });
    fs.writeFileSync(path.join(slotsDir, "memory_guidance.md"), "Guidance content.");
    fs.writeFileSync(path.join(slotsDir, "orchestrator_memory.md"), "Orchestrator content.");

    const body = [
      "{{#if pi_memory}}",
      "{{> pi_memory/memory_guidance}}",
      "{{> pi_memory/orchestrator_memory}}",
      "{{/if}}",
    ].join("\n");

    const result = processTemplate(body, { cwd: tmpDir });

    expect(result).toContain("Guidance content.");
    expect(result).toContain("Orchestrator content.");
  });

  it("handles ifAll with pi_memory and other packages", () => {
    // Create both packages
    for (const pkg of ["pi-memory", "pi-mesh"]) {
      const dir = path.join(tmpDir, "packages", pkg);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "package.json"), `{"name":"${pkg}"}`);
    }

    const body = "{{#ifAll pi_memory pi_mesh}}\nBoth available.\n{{/ifAll}}";
    const result = processTemplate(body, { cwd: tmpDir });

    expect(result).toContain("Both available.");
  });

  it("removes ifAll block when one package is missing", () => {
    const dir = path.join(tmpDir, "packages", "pi-memory");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"pi-memory"}');
    // pi-mesh NOT present

    const body = "{{#ifAll pi_memory pi_mesh}}\nBoth available.\n{{/ifAll}}";
    const result = processTemplate(body, { cwd: tmpDir });

    expect(result).not.toContain("Both available.");
  });

  it("sets pi_bosun=true and resolves pi-bosun slots", () => {
    const pkgDir = path.join(tmpDir, "packages", "pi-bosun");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "package.json"), '{"name":"pi-bosun"}');

    const slotsDir = path.join(pkgDir, "slots");
    fs.mkdirSync(slotsDir, { recursive: true });
    fs.writeFileSync(path.join(slotsDir, "delegation.md"), "Delegate to specialists.");
    fs.writeFileSync(path.join(slotsDir, "workspace.md"), "Write to workspace/.");

    const body = [
      "{{#if pi_bosun}}",
      "{{> pi_bosun/delegation}}",
      "{{/if}}",
      "",
      "{{#if pi_bosun}}",
      "{{> pi_bosun/workspace}}",
      "{{/if}}",
    ].join("\n");

    const result = processTemplate(body, { cwd: tmpDir });

    expect(result).toContain("Delegate to specialists.");
    expect(result).toContain("Write to workspace/.");
  });

  it("renders pi_bosun and pi_mesh slots independently", () => {
    // Both packages exist
    for (const pkg of ["pi-bosun", "pi-mesh"]) {
      const dir = path.join(tmpDir, "packages", pkg);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "package.json"), `{"name":"${pkg}"}`);
    }

    // pi-bosun has slots, pi-mesh doesn't (it's npm, slots come from .pi/slots/)
    const bosunSlots = path.join(tmpDir, "packages", "pi-bosun", "slots");
    fs.mkdirSync(bosunSlots, { recursive: true });
    fs.writeFileSync(path.join(bosunSlots, "workspace.md"), "Bosun workspace.");

    const body = [
      "{{#if pi_mesh}}",
      "Mesh is available.",
      "{{/if}}",
      "",
      "{{#if pi_bosun}}",
      "{{> pi_bosun/workspace}}",
      "{{/if}}",
    ].join("\n");

    const result = processTemplate(body, { cwd: tmpDir });

    expect(result).toContain("Mesh is available.");
    expect(result).toContain("Bosun workspace.");
  });
});
