import { getUser, createUser } from "./handlers.js";
import type { Database } from "./db.js";

export function createRouter(db: Database) {
  return {
    "GET /user": () => getUser(db),
    "POST /user": () => createUser(db),
  };
}
