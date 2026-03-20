/**
 * Math utility functions.
 */

export function calculateTotal(items: number[]): number {
  return items.reduce((sum, item) => sum + item, 0);
}

export function calculateAverage(items: number[]): number {
  if (items.length === 0) return 0;
  return calculateTotal(items) / items.length;
}
