export interface Database {
  findOne(table: string, query: Record<string, unknown>): Promise<unknown>;
  insert(table: string, data: Record<string, unknown>): Promise<unknown>;
}

export function createDatabase(): Database {
  const store: Record<string, unknown[]> = {};
  return {
    findOne: async (table, query) => {
      const rows = store[table] ?? [];
      return rows.find((r: any) => Object.entries(query).every(([k, v]) => r[k] === v)) ?? null;
    },
    insert: async (table, data) => {
      (store[table] ??= []).push({ ...data, id: String(Math.random()) });
      return data;
    },
  };
}
