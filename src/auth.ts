import { db } from "./db";

export function generateId() {
  return crypto.randomUUID();
}

export async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await Bun.password.verify(password, hash);
}

export function createSession(userId: string): string {
  const sessionId = generateId();
  // Session expires in 7 days
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [
    sessionId,
    userId,
    expiresAt,
  ]);

  return sessionId;
}

export function deleteSession(sessionId: string) {
  db.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
}

export function getUserIdFromSession(sessionId: string): string | null {
  const session = db.query("SELECT user_id, expires_at FROM sessions WHERE id = ?").get(sessionId) as { user_id: string, expires_at: string } | undefined;

  if (!session) return null;

  if (new Date(session.expires_at) < new Date()) {
    deleteSession(sessionId);
    return null;
  }

  return session.user_id;
}

export function getSessionIdFromRequest(req: Request): string | null {
  const cookieHeader = req.headers.get("Cookie");
  if (!cookieHeader) return null;

  const cookies = Object.fromEntries(
    cookieHeader.split("; ").map((c) => c.split("="))
  );

  return cookies.session_id || null;
}
