/**
 * Generate an array of numbers from start to end (inclusive).
 * range(1, 5) should return [1, 2, 3, 4, 5]
 */
export function range(start: number, end: number): number[] {
  const result: number[] = [];
  for (let i = start; i < end; i++) {
    result.push(i);
  }
  return result;
}
