import { accessSync, constants, mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";

const TEMP_NAMESPACE = "pi-agents-tests";

let cachedRoot: string | null = null;

function isWritableDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function selectTempRoot(): string {
  if (cachedRoot) return cachedRoot;

  const candidates = [
    process.env.TMPDIR ? resolve(process.env.TMPDIR, TEMP_NAMESPACE) : null,
    resolve("/dev/shm", TEMP_NAMESPACE),
    resolve(process.cwd(), "..", "..", "workspace", "scratch", TEMP_NAMESPACE),
    resolve(process.cwd(), ".tmp", TEMP_NAMESPACE),
  ].filter((value): value is string => Boolean(value && value.trim()));

  for (const candidate of candidates) {
    if (isWritableDir(candidate)) {
      cachedRoot = candidate;
      return candidate;
    }
  }

  throw new Error("No writable temp root available for pi-agents tests.");
}

export function createTempDir(prefix: string): string {
  return mkdtempSync(join(selectTempRoot(), prefix));
}
