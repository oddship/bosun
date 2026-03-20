export class Database {
  private connected = false;

  async connect(): Promise<void> { this.connected = true; }
  async disconnect(): Promise<void> { this.connected = false; }

  async query(sql: string): Promise<unknown[]> {
    if (!this.connected) throw new Error("Not connected");
    return [];
  }
}
