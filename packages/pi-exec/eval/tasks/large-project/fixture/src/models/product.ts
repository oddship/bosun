import type { Database } from "../utils/database.js";

export class ProductManager {
  constructor(private db: Database) {}
  async findById(id: string) { return this.db.query(`SELECT * FROM products WHERE id = '${id}'`); }
  async list() { return this.db.query("SELECT * FROM products"); }
  async create(name: string, price: number) { return this.db.query(`INSERT INTO products (name, price) VALUES ('${name}', ${price})`); }
}
