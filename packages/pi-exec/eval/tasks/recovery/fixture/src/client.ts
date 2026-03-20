import { CONFIG } from "./config.js";

export async function fetchData(path: string): Promise<unknown> {
  const url = `${CONFIG.apiUrl}/${path}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(CONFIG.timeout) });
  return response.json();
}
