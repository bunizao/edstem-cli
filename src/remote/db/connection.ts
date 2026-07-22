import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export function openDatabase(databasePath: string): Database {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}
