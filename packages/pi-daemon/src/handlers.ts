/**
 * Handler loading and execution.
 *
 * Handlers are dynamically imported from the configured handlers_dir.
 * Each handler file must export a default async function matching HandlerFn.
 *
 * Built-in handler: "pi-spawn" runs `pi --print '<prompt>'` and writes output to a file.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { info, error, debug } from "./logger.js";
import type { HandlerFn, HandlerContext } from "./types.js";

/** Cache of loaded handler functions. */
const handlerCache = new Map<string, HandlerFn>();

let handlersDir: string;
let cwd: string;

export function initHandlers(dir: string, rootCwd: string): void {
  handlersDir = dir;
  cwd = rootCwd;
}

/**
 * Load a handler by name via dynamic import.
 * Looks for `{handlers_dir}/{name}.ts` or `{handlers_dir}/{name}.js`.
 */
async function loadHandler(name: string): Promise<HandlerFn> {
  // Check cache
  const cached = handlerCache.get(name);
  if (cached) return cached;

  const dir = resolve(cwd, handlersDir);

  // Try .ts first, then .js
  for (const ext of [".ts", ".js"]) {
    const filePath = join(dir, `${name}${ext}`);
    if (existsSync(filePath)) {
      debug(`Loading handler: ${filePath}`);
      try {
        const mod = await import(filePath);
        const fn: HandlerFn = mod.default;
        if (typeof fn !== "function") {
          throw new Error(`Handler ${name} does not export a default function`);
        }
        handlerCache.set(name, fn);
        return fn;
      } catch (err) {
        error(`Failed to load handler ${name}: ${err}`);
        throw err;
      }
    }
  }

  throw new Error(`Handler not found: ${name} (looked in ${dir})`);
}

/** Run a named handler with the given context. */
export async function runHandler(name: string, context: HandlerContext): Promise<void> {
  info(`Running handler: ${name}`);
  const fn = await loadHandler(name);
  await fn(context);
}

/** Clear the handler cache (useful after config reload). */
export function clearHandlerCache(): void {
  handlerCache.clear();
}
