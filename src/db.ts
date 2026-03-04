import { Database } from "bun:sqlite";

export const db = new Database("db/app.sqlite", { create: true });
db.exec("PRAGMA journal_mode = WAL;");
