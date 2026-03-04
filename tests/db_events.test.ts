import { test, expect, beforeAll } from "bun:test";
import { db } from "../src/db";
import { generateId } from "../src/auth";
import { broadcastEvent } from "../src/events";
import { readFileSync } from "fs";

beforeAll(() => {
  db.run("DELETE FROM events");
  db.run("DELETE FROM messages");
  db.run("DELETE FROM conversations");
  db.run("DELETE FROM sessions");
  db.run("DELETE FROM users");
});

test("Database inserts correctly", () => {
  const userId = generateId();
  db.run("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)", [userId, "test1", "hash"]);

  const convId = generateId();
  db.run("INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)", [convId, userId, "Test Conv"]);

  const fetched = db.query("SELECT * FROM conversations WHERE id = ?").get(convId) as any;
  expect(fetched.title).toEqual("Test Conv");
});

test("Events system logs and broadcasts", async () => {
  const convId = generateId();
  const eventPayload = { message: "test system event" };

  await broadcastEvent(convId, {
    type: "system",
    payload: eventPayload
  });

  // Verify DB insert
  const event = db.query("SELECT * FROM events WHERE conversation_id = ?").get(convId) as any;
  expect(event).toBeDefined();
  expect(event.event_type).toEqual("system");
  expect(JSON.parse(event.payload)).toEqual(eventPayload);

  // Verify JSONL file (basic check)
  const logContent = readFileSync("logs/events.jsonl", "utf8");
  expect(logContent).toContain("test system event");
});
