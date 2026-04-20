/**
 * Provider-level prompt tuning overlays.
 *
 * Used to inject small model/provider-specific behavior adjustments without
 * duplicating instructions across every agent definition.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface ProviderPromptTuningOptions {
  cwd: string;
  provider?: string;
  packageRoot?: string;
}

function getDefaultPackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function sanitizeProvider(provider: string): string {
  return provider.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
}

function readIfExists(filePath: string): string {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf-8").trim();
}

/**
 * Resolve provider-level prompt tuning.
 *
 * Resolution order:
 * 1. Project override: .pi/prompt-tuning/providers/<provider>.md
 * 2. Package default:  <packageRoot>/prompt-tuning/providers/<provider>.md
 */
export function resolveProviderPromptTuning(options: ProviderPromptTuningOptions): string {
  const provider = options.provider?.trim();
  if (!provider) return "";

  const providerKey = sanitizeProvider(provider);
  if (!providerKey) return "";

  const packageRoot = options.packageRoot || getDefaultPackageRoot();
  const candidates = [
    path.join(options.cwd, ".pi", "prompt-tuning", "providers", `${providerKey}.md`),
    path.join(packageRoot, "prompt-tuning", "providers", `${providerKey}.md`),
  ];

  for (const candidate of candidates) {
    const content = readIfExists(candidate);
    if (content) return content;
  }

  return "";
}

/**
 * Derive provider from the active model or a resolved provider-qualified model id.
 */
export function resolvePromptTuningProvider(
  model: { provider?: string } | undefined,
  resolvedModelId?: string,
): string | undefined {
  if (model?.provider) return model.provider;
  if (!resolvedModelId) return undefined;

  const slashIndex = resolvedModelId.indexOf("/");
  if (slashIndex <= 0) return undefined;
  return resolvedModelId.slice(0, slashIndex);
}
