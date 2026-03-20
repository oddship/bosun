export function parse(input: string): number {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  return parseFloat(cleaned);
}

// DEAD: not imported by anything
export function parseMany(inputs: string[]): number[] {
  return inputs.map(parse);
}
