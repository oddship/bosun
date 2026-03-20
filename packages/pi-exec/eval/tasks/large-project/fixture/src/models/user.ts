import type { Database } from "../utils/database.js";

export class UserManager {
  constructor(private db: Database) {}
  async findById(id: string) { return this.db.query(`SELECT * FROM users WHERE id = '${id}'`); }
  async create(name: string, email: string) { return this.db.query(`INSERT INTO users (name, email) VALUES ('${name}', '${email}')`); }
  async delete(id: string) { return this.db.query(`DELETE FROM users WHERE id = '${id}'`); }
}
