import type { Database } from "bun:sqlite";

import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

export interface AuthorizationCodeRecord {
  clientId: string;
  codeChallenge: string;
  displayName: string;
  expiresAt: number;
  issuedAt: number;
  redirectUri: string;
  resource?: string;
  scopes: string[];
  userId: number;
  username: string;
}

export interface AccessTokenRecord {
  clientId: string;
  displayName: string;
  expiresAt: number;
  issuedAt: number;
  refreshToken?: string;
  resource?: string;
  scopes: string[];
  userId: number;
  username: string;
}

export interface RefreshTokenRecord {
  clientId: string;
  displayName: string;
  expiresAt: number;
  issuedAt: number;
  resource?: string;
  scopes: string[];
  userId: number;
  username: string;
}

type AuthorizationCodeRow = {
  client_id: string;
  code_challenge: string;
  display_name: string;
  expires_at: number;
  issued_at: number;
  redirect_uri: string;
  resource: string | null;
  scopes: string;
  user_id: number;
  username: string;
};

type AccessTokenRow = {
  client_id: string;
  display_name: string;
  expires_at: number;
  issued_at: number;
  refresh_token: string | null;
  resource: string | null;
  scopes: string;
  user_id: number;
  username: string;
};

type RefreshTokenRow = {
  client_id: string;
  display_name: string;
  expires_at: number;
  issued_at: number;
  resource: string | null;
  scopes: string;
  user_id: number;
  username: string;
};

type ClientRow = {
  client_data: string;
};

export class SqlOAuthStore {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  deleteAccessToken(token: string): void {
    this.db.query("DELETE FROM oauth_access_tokens WHERE token = ?").run(token);
  }

  deleteAuthorizationCode(code: string): void {
    this.db.query("DELETE FROM oauth_authorization_codes WHERE code = ?").run(code);
  }

  deleteRefreshToken(token: string): void {
    this.db.query("DELETE FROM oauth_refresh_tokens WHERE token = ?").run(token);
  }

  getAccessToken(token: string): AccessTokenRecord | undefined {
    const row = this.db
      .query(
        `
          SELECT client_id, display_name, expires_at, issued_at, refresh_token,
                 resource, scopes, user_id, username
          FROM oauth_access_tokens
          WHERE token = ?
        `
      )
      .get(token) as AccessTokenRow | undefined;

    return row ? mapAccessToken(row) : undefined;
  }

  getAuthorizationCode(code: string): AuthorizationCodeRecord | undefined {
    const row = this.db
      .query(
        `
          SELECT client_id, code_challenge, display_name, expires_at, issued_at,
                 redirect_uri, resource, scopes, user_id, username
          FROM oauth_authorization_codes
          WHERE code = ?
        `
      )
      .get(code) as AuthorizationCodeRow | undefined;

    return row ? mapAuthorizationCode(row) : undefined;
  }

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = this.db
      .query("SELECT client_data FROM oauth_clients WHERE client_id = ?")
      .get(clientId) as ClientRow | undefined;

    if (!row) {
      return undefined;
    }

    return JSON.parse(row.client_data) as OAuthClientInformationFull;
  }

  getRefreshToken(token: string): RefreshTokenRecord | undefined {
    const row = this.db
      .query(
        `
          SELECT client_id, display_name, expires_at, issued_at, resource, scopes,
                 user_id, username
          FROM oauth_refresh_tokens
          WHERE token = ?
        `
      )
      .get(token) as RefreshTokenRow | undefined;

    return row ? mapRefreshToken(row) : undefined;
  }

  pruneExpired(now: number = Date.now()): {
    accessTokensDeleted: number;
    authorizationCodesDeleted: number;
    refreshTokensDeleted: number;
    totalDeleted: number;
  } {
    const accessTokensDeleted = runDelete(
      this.db.query("DELETE FROM oauth_access_tokens WHERE expires_at <= ?").run(now)
    );
    const refreshTokensDeleted = runDelete(
      this.db.query("DELETE FROM oauth_refresh_tokens WHERE expires_at <= ?").run(now)
    );
    const authorizationCodesDeleted = runDelete(
      this.db.query("DELETE FROM oauth_authorization_codes WHERE expires_at <= ?").run(now)
    );

    return {
      accessTokensDeleted,
      authorizationCodesDeleted,
      refreshTokensDeleted,
      totalDeleted:
        accessTokensDeleted + refreshTokensDeleted + authorizationCodesDeleted
    };
  }

  saveAccessToken(token: string, record: AccessTokenRecord): void {
    this.db
      .query(
        `
          INSERT INTO oauth_access_tokens (
            token, client_id, user_id, display_name, username, resource,
            scopes, refresh_token, expires_at, created_at, issued_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?
          )
        `
      )
      .run(
        token,
        record.clientId,
        record.userId,
        record.displayName,
        record.username,
        record.resource ?? null,
        JSON.stringify(record.scopes),
        record.refreshToken ?? null,
        record.expiresAt,
        Date.now(),
        record.issuedAt
      );
  }

  saveAuthorizationCode(code: string, record: AuthorizationCodeRecord): void {
    this.db
      .query(
        `
          INSERT INTO oauth_authorization_codes (
            code, client_id, user_id, redirect_uri, code_challenge, scopes,
            resource, display_name, username, expires_at, created_at, issued_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?
          )
        `
      )
      .run(
        code,
        record.clientId,
        record.userId,
        record.redirectUri,
        record.codeChallenge,
        JSON.stringify(record.scopes),
        record.resource ?? null,
        record.displayName,
        record.username,
        record.expiresAt,
        Date.now(),
        record.issuedAt
      );
  }

  saveClient(client: OAuthClientInformationFull): void {
    this.db
      .query(
        `
          INSERT INTO oauth_clients (client_id, client_data, created_at)
          VALUES (?, ?, ?)
          ON CONFLICT(client_id) DO UPDATE SET
            client_data = excluded.client_data
        `
      )
      .run(client.client_id, JSON.stringify(client), Date.now());
  }

  saveRefreshToken(token: string, record: RefreshTokenRecord): void {
    this.db
      .query(
        `
          INSERT INTO oauth_refresh_tokens (
            token, client_id, user_id, display_name, username, resource,
            scopes, expires_at, created_at, issued_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?
          )
        `
      )
      .run(
        token,
        record.clientId,
        record.userId,
        record.displayName,
        record.username,
        record.resource ?? null,
        JSON.stringify(record.scopes),
        record.expiresAt,
        Date.now(),
        record.issuedAt
      );
  }
}

function parseScopes(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function mapAuthorizationCode(row: AuthorizationCodeRow): AuthorizationCodeRecord {
  return {
    clientId: row.client_id,
    codeChallenge: row.code_challenge,
    displayName: row.display_name,
    expiresAt: row.expires_at,
    issuedAt: row.issued_at,
    redirectUri: row.redirect_uri,
    resource: row.resource ?? undefined,
    scopes: parseScopes(row.scopes),
    userId: row.user_id,
    username: row.username
  };
}

function mapAccessToken(row: AccessTokenRow): AccessTokenRecord {
  return {
    clientId: row.client_id,
    displayName: row.display_name,
    expiresAt: row.expires_at,
    issuedAt: row.issued_at,
    refreshToken: row.refresh_token ?? undefined,
    resource: row.resource ?? undefined,
    scopes: parseScopes(row.scopes),
    userId: row.user_id,
    username: row.username
  };
}

function mapRefreshToken(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    clientId: row.client_id,
    displayName: row.display_name,
    expiresAt: row.expires_at,
    issuedAt: row.issued_at,
    resource: row.resource ?? undefined,
    scopes: parseScopes(row.scopes),
    userId: row.user_id,
    username: row.username
  };
}

function runDelete(result: unknown): number {
  return typeof result === "object" &&
    result !== null &&
    "changes" in result &&
    typeof result.changes === "number"
    ? result.changes
    : 0;
}
