import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "./db";
import { generateId } from "./auth";

const LOG_FILE = resolve(process.cwd(), "logs", "events.jsonl");

export interface AppEvent {
  type: "system" | "user_message" | "assistant_chunk" | "assistant_done" | "error" | "thinking";
  conversationId?: string;
  payload?: any;
}

export async function logEvent(event: AppEvent) {
  const timestamp = new Date().toISOString();
  const eventId = generateId();

  const logEntry = {
    id: eventId,
    timestamp,
    ...event,
  };

  // 1. Append to JSON Lines file
  try {
    await appendFile(LOG_FILE, JSON.stringify(logEntry) + "\n");
  } catch (err) {
    console.error("Failed to write to event log:", err);
  }

  // 2. Persist to SQLite
  try {
    db.run(
      "INSERT INTO events (id, conversation_id, event_type, payload) VALUES (?, ?, ?, ?)",
      [
        eventId,
        event.conversationId || null,
        event.type,
        event.payload ? JSON.stringify(event.payload) : null,
      ]
    );
  } catch (err) {
    console.error("Failed to insert event to db:", err);
  }
}
