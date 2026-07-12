import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Database } from "bun:sqlite";

const MIGRATIONS_DIR = resolveMigrationsDir();

export function migrateDatabase(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set<number>();
  for (const row of db.query("SELECT version FROM schema_migrations").all() as Array<{ version: number }>) {
    applied.add(row.version);
  }

  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrations) {
    const version = Number.parseInt(file.slice(0, 3), 10);
    if (Number.isNaN(version) || applied.has(version)) {
      continue;
    }

    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    const apply = db.transaction(() => {
      db.exec(sql);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        version,
        Date.now()
      );
    });
    apply();
  }
}

function resolveMigrationsDir(): string {
  const candidates = [
    path.resolve(import.meta.dir, "migrations"),
    path.resolve(process.cwd(), "src", "remote", "db", "migrations")
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Database migrations directory not found. Checked: ${candidates.join(", ")}`
  );
}
