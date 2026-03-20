/**
 * Data processor — handles CSV parsing and analysis.
 */

export interface DataRow {
  name: string;
  value: number;
  category: string;
}

export function processData(csvLines: string[]): {
  rows: DataRow[];
  summary: { total: number; average: number; categories: string[] };
} {
  // Parse CSV lines into rows
  const rows: DataRow[] = [];
  for (const line of csvLines) {
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 3) continue;
    const name = parts[0];
    const value = parseFloat(parts[1]);
    if (isNaN(value)) continue;
    const category = parts[2];
    rows.push({ name, value, category });
  }

  // Calculate summary statistics
  let total = 0;
  for (const row of rows) {
    total += row.value;
  }
  const average = rows.length > 0 ? total / rows.length : 0;
  const categorySet = new Set<string>();
  for (const row of rows) {
    categorySet.add(row.category);
  }
  const categories = Array.from(categorySet).sort();

  return { rows, summary: { total, average, categories } };
}
