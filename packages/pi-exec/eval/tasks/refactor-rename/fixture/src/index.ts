import { UserService } from "./UserService.js";
import { createDatabase } from "./database.js";

export function createApp() {
  const db = createDatabase();
  const userService = new UserService(db);
  return { userService };
}
