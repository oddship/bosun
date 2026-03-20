import type { Database } from "./database.js";

export class UserService {
  constructor(private db: Database) {}

  async getById(id: string) {
    return this.db.findOne("users", { id });
  }

  async create(name: string, email: string) {
    return this.db.insert("users", { name, email });
  }
}
