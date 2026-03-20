/**
 * Input sanitizer — currently incomplete.
 */

export function sanitizeHtml(input: string): string {
  // Only handles < and > but misses & and quotes
  return input
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function sanitizeForSql(input: string): string {
  // Only handles single quotes
  return input.replace(/'/g, "''");
}
