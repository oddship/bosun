export class Config {
  private values: Record<string, string> = {};

  set(key: string, value: string) { this.values[key] = value; }
  get(key: string): string | undefined { return this.values[key]; }
  getRequired(key: string): string {
    const val = this.values[key];
    if (val === undefined) throw new Error(`Missing config: ${key}`);
    return val;
  }
}
