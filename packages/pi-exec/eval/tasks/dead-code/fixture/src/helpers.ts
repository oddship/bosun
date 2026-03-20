export function padLeft(str: string, length: number): string {
  return str.padStart(length, " ");
}

// DEAD: not imported by anything
export function padRight(str: string, length: number): string {
  return str.padEnd(length, " ");
}

// DEAD: not imported by anything
export function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
}
