import { calculateTotal, calculateAverage } from "./math.js";

export function generateReport(values: number[]): string {
  const total = calculateTotal(values);
  const avg = calculateAverage(values);
  return `Total: ${total}, Average: ${avg.toFixed(2)}`;
}
