/**
 * pi-agents library — agent discovery, config, templates, and spawning.
 *
 * Use this module to work with Pi agents programmatically,
 * e.g., from daemon workflows or scripts:
 *
 *   import { spawnAgent, loadConfig, findAgentFile, loadAgent } from "pi-agents";
 */

export { discoverAgents, findAgentFile, loadAgent } from "./agents.js";
export type { AgentDef } from "./agents.js";

export { loadConfig } from "./config.js";
export type { AgentsConfig, BackendConfig } from "./config.js";

export { processTemplate } from "./template.js";
export type { TemplateContext } from "./template.js";

export { resolveModel } from "./models.js";

export { spawnAgent } from "./spawn.js";
export type { SpawnAgentOptions, SpawnAgentResult } from "./spawn.js";
