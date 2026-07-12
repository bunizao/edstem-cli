import type { Database } from "bun:sqlite";

export interface CredentialRecord {
  authTag: Buffer;
  ciphertext: Buffer;
  createdAt: number;
  edUserId: number;
  edUserName: string;
  isInvalid: boolean;
  iv: Buffer;
  lastVerifiedAt: number;
  updatedAt: number;
  userId: number;
}

type CredentialRow = {
  auth_tag: Buffer;
  ciphertext: Buffer;
  created_at: number;
  ed_user_id: number;
  ed_user_name: string;
  is_invalid: number;
  iv: Buffer;
  last_verified_at: number;
  updated_at: number;
  user_id: number;
};

export class CredentialsRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  delete(userId: number): void {
    this.db.query("DELETE FROM ed_credentials WHERE user_id = ?").run(userId);
  }

  getByUserId(userId: number): CredentialRecord | null {
    const row = this.db
      .query(
        `
          SELECT user_id, ciphertext, iv, auth_tag, ed_user_id, ed_user_name,
                 is_invalid, last_verified_at, created_at, updated_at
          FROM ed_credentials
          WHERE user_id = ?
        `
      )
      .get(userId) as CredentialRow | undefined;

    return row ? mapCredential(row) : null;
  }

  markInvalid(userId: number): void {
    this.db
      .query("UPDATE ed_credentials SET is_invalid = 1, updated_at = ? WHERE user_id = ?")
      .run(Date.now(), userId);
  }

  upsert(input: {
    authTag: Buffer;
    ciphertext: Buffer;
    edUserId: number;
    edUserName: string;
    iv: Buffer;
    lastVerifiedAt: number;
    userId: number;
  }): void {
    const now = Date.now();
    this.db
      .query(
        `
          INSERT INTO ed_credentials (
            user_id, ciphertext, iv, auth_tag, ed_user_id, ed_user_name,
            is_invalid, last_verified_at, created_at, updated_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?,
            0, ?, ?, ?
          )
          ON CONFLICT(user_id) DO UPDATE SET
            ciphertext = excluded.ciphertext,
            iv = excluded.iv,
            auth_tag = excluded.auth_tag,
            ed_user_id = excluded.ed_user_id,
            ed_user_name = excluded.ed_user_name,
            is_invalid = 0,
            last_verified_at = excluded.last_verified_at,
            updated_at = excluded.updated_at
        `
      )
      .run(
        input.userId,
        input.ciphertext,
        input.iv,
        input.authTag,
        input.edUserId,
        input.edUserName,
        input.lastVerifiedAt,
        now,
        now
      );
  }
}

function mapCredential(row: CredentialRow): CredentialRecord {
  return {
    authTag: row.auth_tag,
    ciphertext: row.ciphertext,
    createdAt: row.created_at,
    edUserId: row.ed_user_id,
    edUserName: row.ed_user_name,
    isInvalid: row.is_invalid === 1,
    iv: row.iv,
    lastVerifiedAt: row.last_verified_at,
    updatedAt: row.updated_at,
    userId: row.user_id
  };
}
