#!/usr/bin/env bun
/**
 * Workflow DAG Visualization
 *
 * Scans discovered workflows, maps trigger/output relationships,
 * and generates an HTML file with a Mermaid diagram.
 *
 * Usage: bun scripts/workflow-dag.ts [output-path]
 */

import { discoverWorkflows, type WorkflowConfig } from "../packages/pi-daemon/src/workflows.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = process.cwd();
const outputPath = process.argv[2] || join(ROOT, "workspace", "workflow-dag.html");

const workflows = discoverWorkflows(ROOT);

// Build mermaid diagram
const lines: string[] = ["graph TD"];
const nodeStyles: string[] = [];

for (const wf of workflows) {
  const nodeId = wf.name.replace(/-/g, "_");
  const icon = wf.type === "agent" ? "🤖" : "📜";
  const label = `${icon} ${wf.name}`;

  // Node shape based on type
  if (wf.type === "agent") {
    lines.push(`    ${nodeId}["${label}"]`);
  } else {
    lines.push(`    ${nodeId}(["${label}"])`);
  }

  // Trigger edges
  if (wf.trigger.schedule) {
    const schedId = `sched_${nodeId}`;
    lines.push(`    ${schedId}[/"⏰ ${wf.trigger.schedule}"/]`);
    lines.push(`    ${schedId} --> ${nodeId}`);
    nodeStyles.push(`style ${schedId} fill:#e1f5fe,stroke:#0288d1`);
  }

  if (wf.trigger.watcher) {
    // Check if this watcher pattern matches another workflow's output
    const pattern = wf.trigger.watcher;
    let foundUpstream = false;

    for (const other of workflows) {
      if (other.name === wf.name) continue;
      // Check if the other workflow's agent prompt mentions writing to a path
      // that matches this watcher pattern
      const otherAgent = other.agent?.prompt || "";
      const otherMd = other.agent?.systemPromptFile
        ? (() => { try { return readFileSync(other.agent.systemPromptFile, "utf-8"); } catch { return ""; } })()
        : "";

      // Simple heuristic: if the watcher path contains a directory that the other agent writes to
      const watchDir = pattern.split("*")[0].replace(/\/$/, "");
      if (watchDir && (otherAgent.includes(watchDir) || otherMd.includes(watchDir))) {
        const otherId = other.name.replace(/-/g, "_");
        lines.push(`    ${otherId} -->|"writes to ${watchDir}"| ${nodeId}`);
        foundUpstream = true;
      }
    }

    if (!foundUpstream) {
      const watchId = `watch_${nodeId}`;
      lines.push(`    ${watchId}[/"👁 ${pattern.length > 40 ? pattern.slice(0, 37) + '...' : pattern}"/]`);
      lines.push(`    ${watchId} --> ${nodeId}`);
      nodeStyles.push(`style ${watchId} fill:#fff3e0,stroke:#f57c00`);
    }
  }

  // Style
  if (wf.type === "agent") {
    nodeStyles.push(`style ${nodeId} fill:#e8f5e9,stroke:#388e3c`);
  } else {
    nodeStyles.push(`style ${nodeId} fill:#fce4ec,stroke:#c62828`);
  }
}

lines.push(...nodeStyles);
const mermaidCode = lines.join("\n");

// Build config summaries
const configSummaries = workflows.map(wf => {
  let configContent = "";
  try {
    configContent = readFileSync(join(wf.dir, "config.toml"), "utf-8");
  } catch {}

  return {
    name: wf.name,
    type: wf.type,
    source: wf.source,
    dir: wf.dir,
    config: configContent,
    hasAgent: !!wf.agent?.systemPromptFile,
    hasInputValidator: !!wf.validators.input,
    hasOutputValidator: !!wf.validators.output,
    trigger: wf.trigger,
  };
});

// Generate HTML
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Workflow DAG - Bosun</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #fafafa; color: #333; }
    header { background: #1a1a2e; color: white; padding: 1.5rem 2rem; }
    header h1 { font-size: 1.5rem; font-weight: 600; }
    header p { opacity: 0.7; margin-top: 0.3rem; font-size: 0.9rem; }
    .container { max-width: 1200px; margin: 2rem auto; padding: 0 2rem; }
    .dag-container { background: white; border-radius: 8px; padding: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 2rem; }
    .dag-container h2 { margin-bottom: 1rem; font-size: 1.2rem; }
    .workflows { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 1rem; }
    .workflow-card { background: white; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-left: 4px solid #388e3c; }
    .workflow-card.script { border-left-color: #c62828; }
    .workflow-card h3 { font-size: 1rem; margin-bottom: 0.5rem; }
    .workflow-card .meta { font-size: 0.8rem; color: #666; margin-bottom: 0.75rem; }
    .workflow-card .badges span { display: inline-block; font-size: 0.7rem; padding: 0.15rem 0.5rem; border-radius: 12px; margin-right: 0.3rem; margin-bottom: 0.3rem; }
    .badge-agent { background: #e8f5e9; color: #2e7d32; }
    .badge-script { background: #fce4ec; color: #c62828; }
    .badge-schedule { background: #e1f5fe; color: #0277bd; }
    .badge-watcher { background: #fff3e0; color: #e65100; }
    .badge-validator { background: #f3e5f5; color: #6a1b9a; }
    details { margin-top: 0.75rem; }
    summary { cursor: pointer; font-size: 0.85rem; color: #555; }
    pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 0.8rem; margin-top: 0.5rem; white-space: pre-wrap; }
    .generated { text-align: center; color: #999; font-size: 0.8rem; margin-top: 2rem; padding-bottom: 2rem; }
  </style>
</head>
<body>
  <header>
    <h1>Workflow DAG</h1>
    <p>${workflows.length} workflows discovered &middot; Generated ${new Date().toISOString()}</p>
  </header>

  <div class="container">
    <div class="dag-container">
      <h2>Dependency Graph</h2>
      <div class="mermaid">
${mermaidCode}
      </div>
    </div>

    <h2 style="margin-bottom: 1rem; font-size: 1.2rem;">Workflows</h2>
    <div class="workflows">
${configSummaries.map(wf => `
      <div class="workflow-card ${wf.type}">
        <h3>${wf.type === 'agent' ? '🤖' : '📜'} ${wf.name}</h3>
        <div class="meta">${wf.source} &middot; ${wf.dir.replace(ROOT + '/', '')}</div>
        <div class="badges">
          <span class="badge-${wf.type}">${wf.type}</span>
          ${wf.trigger.schedule ? `<span class="badge-schedule">${wf.trigger.schedule}</span>` : ''}
          ${wf.trigger.watcher ? `<span class="badge-watcher">watcher</span>` : ''}
          ${wf.hasInputValidator ? '<span class="badge-validator">input validator</span>' : ''}
          ${wf.hasOutputValidator ? '<span class="badge-validator">output validator</span>' : ''}
        </div>
        ${wf.config ? `<details><summary>config.toml</summary><pre>${wf.config}</pre></details>` : ''}
      </div>
`).join('')}
    </div>

    <p class="generated">Generated by <code>bun scripts/workflow-dag.ts</code></p>
  </div>

  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
  </script>
</body>
</html>`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, html);
console.log(`DAG visualization written to: ${outputPath}`);
console.log(`Open in browser: file://${outputPath}`);
