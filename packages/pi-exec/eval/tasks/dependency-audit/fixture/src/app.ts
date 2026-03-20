import { createRouter } from "./router.js";
import { connectDb } from "./db.js";

export async function startApp() {
  const db = await connectDb();
  const router = createRouter(db);
  return { db, router };
}
