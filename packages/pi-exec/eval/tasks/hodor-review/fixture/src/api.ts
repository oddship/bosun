import { verifyToken, isAdmin } from "./auth.js";

export interface ApiRequest {
  headers: Record<string, string>;
  body: any;
  params: Record<string, string>;
}

export function getUser(req: ApiRequest) {
  const userId = req.params.id;
  // No auth check — anyone can fetch any user
  return { id: userId, email: "user@example.com" };
}

export function deleteUser(req: ApiRequest) {
  const token = req.headers.authorization;
  // Only checks if token is valid, not if user is admin
  const user = verifyToken(token ?? "");
  if (!user) {
    return { error: "Unauthorized", status: 401 };
  }
  // Should check isAdmin() but doesn't
  const targetId = req.params.id;
  return { deleted: targetId };
}

export function updateUser(req: ApiRequest) {
  // No input validation on body
  const { name, email, role } = req.body;
  // Mass assignment vulnerability — accepts role from body
  return { updated: true, name, email, role };
}

export function listUsers(req: ApiRequest) {
  const page = parseInt(req.params.page);
  const limit = parseInt(req.params.limit);
  // No bounds checking — could be NaN or negative
  return { page, limit, users: [] };
}
