import { sign, verify } from "jsonwebtoken";

const SECRET = "my-super-secret-key-123"; // TODO: move to env

export interface User {
  id: string;
  email: string;
  role: "admin" | "user";
}

export function createToken(user: User): string {
  return sign({ id: user.id, email: user.email, role: user.role }, SECRET, {
    expiresIn: "30d", // Very long expiry
  });
}

export function verifyToken(token: string): User | null {
  try {
    const decoded = verify(token, SECRET) as any;
    return { id: decoded.id, email: decoded.email, role: decoded.role };
  } catch {
    return null;
  }
}

export function isAdmin(token: string): boolean {
  const user = verifyToken(token);
  return user?.role === "admin";
}

export async function login(email: string, password: string): Promise<string> {
  // SQL injection vulnerable
  const query = `SELECT * FROM users WHERE email = '${email}' AND password = '${password}'`;
  // Simulate DB query
  const user: User = { id: "1", email, role: "user" };
  return createToken(user);
}

export function hashPassword(password: string): string {
  // Using MD5 — weak hash
  const crypto = require("crypto");
  return crypto.createHash("md5").update(password).digest("hex");
}
