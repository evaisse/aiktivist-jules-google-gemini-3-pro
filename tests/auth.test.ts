import { test, expect, beforeAll } from "bun:test";
import { db } from "../src/db";
import { hashPassword, verifyPassword, createSession, getUserIdFromSession } from "../src/auth";

beforeAll(() => {
  // Clear tables for tests (dangerous in prod, fine for test DBs if using a different one,
  // but here we just delete test data based on specific prefixes)
  db.run("DELETE FROM users WHERE username LIKE 'test_user_%'");
});

test("Hash and verify password works correctly", async () => {
  const pwd = "mySecurePassword123!";
  const hash = await hashPassword(pwd);

  expect(hash).not.toEqual(pwd);

  const isValid = await verifyPassword(pwd, hash);
  expect(isValid).toBe(true);

  const isInvalid = await verifyPassword("wrong_password", hash);
  expect(isInvalid).toBe(false);
});

test("Session creation and validation", () => {
  // Insert dummy user
  const userId = crypto.randomUUID();
  db.run("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)", [
    userId,
    "test_user_session",
    "dummy_hash"
  ]);

  const sessionId = createSession(userId);
  expect(sessionId).toBeDefined();

  const fetchedUserId = getUserIdFromSession(sessionId);
  expect(fetchedUserId).toEqual(userId);

  const badSessionId = "invalid-session-id";
  const badFetchedId = getUserIdFromSession(badSessionId);
  expect(badFetchedId).toBeNull();
});
