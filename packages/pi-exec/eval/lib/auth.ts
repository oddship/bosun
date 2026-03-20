/**
 * Load API key from bosun's auth.json using pi-coding-agent's AuthStorage.
 * Handles OAuth token refresh automatically.
 */

import { join } from "node:path";
import { AuthStorage } from "@mariozechner/pi-coding-agent";

const AUTH_PATHS = [
  join(process.cwd(), ".bosun-home", ".pi", "agent", "auth.json"),
];

let _authStorage: InstanceType<typeof AuthStorage> | null = null;

function getAuthStorage(): InstanceType<typeof AuthStorage> {
  if (!_authStorage) {
    for (const authPath of AUTH_PATHS) {
      try {
        _authStorage = AuthStorage.create(authPath);
        break;
      } catch {
        continue;
      }
    }
    if (!_authStorage) {
      throw new Error(`No auth.json found. Checked: ${AUTH_PATHS.join(", ")}`);
    }
  }
  return _authStorage;
}

/**
 * Get API key for a provider. Handles OAuth refresh automatically.
 */
export async function getApiKey(provider: string): Promise<string> {
  const auth = getAuthStorage();
  const key = await auth.getApiKey(provider);
  if (!key) {
    throw new Error(
      `No API key for provider "${provider}". Run \`pi /login ${provider}\` to authenticate.`,
    );
  }
  return key;
}
