export interface Database {
  query(sql: string): Promise<unknown[]>;
  close(): Promise<void>;
}

export async function connectDb(): Promise<Database> {
  return {
    query: async (sql: string) => [],
    close: async () => {},
  };
}
