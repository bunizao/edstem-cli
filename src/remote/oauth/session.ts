import { createHmac, timingSafeEqual } from "node:crypto";

import type { OAuthConfig } from "../config.js";
import type { UserRecord } from "../users/repository.js";

export interface SessionPayload {
  displayName: string;
  email: string;
  expiresAt: number;
  userId: number;
}

export type SessionState =
  | {
      reason: "missing";
      session: null;
    }
  | {
      reason: "expired" | "invalid";
      session: null;
    }
  | {
      reason: "valid";
      session: SessionPayload;
    };

export function buildExpiredSessionCookie(config: OAuthConfig): string {
  const parts = [
    `${config.sessionCookieName}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0"
  ];
  if (config.issuerUrl.protocol === "https:") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function buildSessionCookie(
  session: SessionPayload,
  config: OAuthConfig,
  now: Date = new Date()
): string {
  const payload = encodePayload(session, config.sessionSecret);
  const maxAge = Math.max(0, Math.floor((session.expiresAt - now.getTime()) / 1000));
  const parts = [
    `${config.sessionCookieName}=${encodeURIComponent(payload)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ];
  if (config.issuerUrl.protocol === "https:") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function createSessionForUser(
  user: UserRecord,
  sessionTtlSeconds: number,
  now: Date = new Date()
): SessionPayload {
  return {
    displayName: user.displayName || user.email,
    email: user.email,
    expiresAt: now.getTime() + sessionTtlSeconds * 1000,
    userId: user.id
  };
}

export function readSessionFromCookieHeader(
  cookieHeader: string | undefined,
  config: OAuthConfig,
  now: Date = new Date()
): SessionPayload | null {
  const state = readSessionStateFromCookieHeader(cookieHeader, config, now);
  return state.session;
}

export function readSessionStateFromCookieHeader(
  cookieHeader: string | undefined,
  config: OAuthConfig,
  now: Date = new Date()
): SessionState {
  const raw = parseCookies(cookieHeader).get(config.sessionCookieName);
  if (!raw) {
    return {
      reason: "missing",
      session: null
    };
  }

  const payload = decodePayload(raw, config.sessionSecret);
  if (!payload) {
    return {
      reason: "invalid",
      session: null
    };
  }

  if (payload.expiresAt <= now.getTime()) {
    return {
      reason: "expired",
      session: null
    };
  }

  return {
    reason: "valid",
    session: payload
  };
}

function parseCookies(cookieHeader: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const fragment of cookieHeader.split(";")) {
    const trimmed = fragment.trim();
    if (!trimmed) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    cookies.set(
      trimmed.slice(0, separator),
      decodeURIComponent(trimmed.slice(separator + 1))
    );
  }

  return cookies;
}

function encodePayload(payload: SessionPayload, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const signature = sign(encoded, secret);
  return `${encoded}.${signature}`;
}

function decodePayload(raw: string, secret: string): SessionPayload | null {
  const separator = raw.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }

  const encoded = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!verify(encoded, signature, secret)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf-8")
    ) as Partial<SessionPayload>;
    if (
      typeof parsed.displayName !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.userId !== "number"
    ) {
      return null;
    }

    return {
      displayName: parsed.displayName,
      email: parsed.email,
      expiresAt: parsed.expiresAt,
      userId: parsed.userId
    };
  } catch {
    return null;
  }
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function verify(value: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(sign(value, secret), "utf-8");
  const actual = Buffer.from(signature, "utf-8");
  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}
