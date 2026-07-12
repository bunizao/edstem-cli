import type { Database } from "bun:sqlite";

export interface UserRecord {
  createdAt: number;
  displayName: string | null;
  email: string;
  edUserId: number | null;
  id: number;
  lastLoginAt: number | null;
}

type UserRow = {
  created_at: number;
  display_name: string | null;
  email: string;
  ed_user_id: number | null;
  id: number;
  last_login_at: number | null;
};

export class UsersRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  create(input: {
    createdAt: number;
    displayName?: string;
    email: string;
    edUserId: number;
    lastLoginAt?: number;
  }): UserRecord {
    const result = this.db
      .query(
        `
          INSERT INTO users (email, password_hash, display_name, created_at, last_login_at, ed_user_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        input.email,
        "",
        input.displayName ?? null,
        input.createdAt,
        input.lastLoginAt ?? null,
        input.edUserId
      );

    return this.getById(Number(result.lastInsertRowid)) as UserRecord;
  }

  delete(userId: number): void {
    this.db.query("DELETE FROM users WHERE id = ?").run(userId);
  }

  getByEmail(email: string): UserRecord | null {
    const row = this.db
      .query(
        `
          SELECT id, email, display_name, created_at, last_login_at, ed_user_id
          FROM users
          WHERE email = ?
        `
      )
      .get(email) as UserRow | undefined;

    return row ? mapUser(row) : null;
  }

  getById(userId: number): UserRecord | null {
    const row = this.db
      .query(
        `
          SELECT id, email, display_name, created_at, last_login_at, ed_user_id
          FROM users
          WHERE id = ?
        `
      )
      .get(userId) as UserRow | undefined;

    return row ? mapUser(row) : null;
  }

  getByEdUserId(edUserId: number): UserRecord | null {
    const row = this.db
      .query(
        `
          SELECT id, email, display_name, created_at, last_login_at, ed_user_id
          FROM users
          WHERE ed_user_id = ?
        `
      )
      .get(edUserId) as UserRow | undefined;

    return row ? mapUser(row) : null;
  }

  updateIdentity(
    userId: number,
    input: {
      displayName?: string;
      email: string;
      edUserId: number;
      lastLoginAt?: number;
    }
  ): void {
    this.db
      .query(
        `
          UPDATE users
          SET email = ?, display_name = ?, ed_user_id = ?, last_login_at = ?
          WHERE id = ?
        `
      )
      .run(
        input.email,
        input.displayName ?? null,
        input.edUserId,
        input.lastLoginAt ?? null,
        userId
      );
  }

  touchLastLogin(userId: number, timestamp: number): void {
    this.db.query("UPDATE users SET last_login_at = ? WHERE id = ?").run(timestamp, userId);
  }
}

function mapUser(row: UserRow): UserRecord {
  return {
    createdAt: row.created_at,
    displayName: row.display_name,
    email: row.email,
    edUserId: row.ed_user_id,
    id: row.id,
    lastLoginAt: row.last_login_at
  };
}
