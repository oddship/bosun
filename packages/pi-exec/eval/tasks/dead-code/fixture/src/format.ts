import { padLeft } from "./helpers.js";

export function format(value: number): string {
  return padLeft(value.toFixed(2), 10);
}

// DEAD: not exported from index.ts, not imported anywhere
export function formatCurrency(value: number, currency: string): string {
  return `${currency} ${value.toFixed(2)}`;
}
