import type { Database } from "./db.js";
import { validate } from "./utils.js";

export async function getUser(db: Database) {
  const rows = await db.query("SELECT * FROM users LIMIT 1");
  return rows[0] ?? null;
}

export async function createUser(db: Database) {
  validate({ name: "test" });
  await db.query("INSERT INTO users (name) VALUES ('test')");
  return { created: true };
}
