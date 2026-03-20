export function validate(data: Record<string, unknown>): boolean {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid data");
  }
  return true;
}

export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}
