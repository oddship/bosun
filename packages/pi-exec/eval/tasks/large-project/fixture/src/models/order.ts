import type { Database } from "../utils/database.js";

export class OrderManager {
  constructor(private db: Database) {}
  async create(userId: string, productId: string, quantity: number) {
    return this.db.query(`INSERT INTO orders (user_id, product_id, qty) VALUES ('${userId}', '${productId}', ${quantity})`);
  }
  async findByUser(userId: string) { return this.db.query(`SELECT * FROM orders WHERE user_id = '${userId}'`); }
}
