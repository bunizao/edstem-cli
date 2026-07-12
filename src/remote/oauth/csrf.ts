import { randomBytes } from "node:crypto";

import type { OAuthConfig } from "../config.js";

const CSRF_COOKIE_NAME = "edstem_mcp_csrf";

export function buildCsrfCookie(config: OAuthConfig, token: string): string {
  const parts = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${config.sessionTtlSeconds}`
  ];

  if (config.issuerUrl.protocol === "https:") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function buildExpiredCsrfCookie(config: OAuthConfig): string {
  const parts = [
    `${CSRF_COOKIE_NAME}=`,
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

export function ensureCsrfToken(
  cookieHeader: string | undefined
): { cookie?: string; token: string } {
  const current = readCookie(cookieHeader, CSRF_COOKIE_NAME);
  if (current) {
    return { token: current };
  }

  const token = randomBytes(32).toString("base64url");
  return {
    cookie: token,
    token
  };
}

export function readCsrfToken(cookieHeader: string | undefined): string | null {
  return readCookie(cookieHeader, CSRF_COOKIE_NAME) ?? null;
}

export function validateCsrfToken(
  cookieHeader: string | undefined,
  formToken: string | undefined
): boolean {
  const cookieToken = readCsrfToken(cookieHeader);
  return Boolean(cookieToken && formToken && cookieToken === formToken);
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const fragment of cookieHeader.split(";")) {
    const trimmed = fragment.trim();
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    if (trimmed.slice(0, separator) !== name) {
      continue;
    }
    return decodeURIComponent(trimmed.slice(separator + 1));
  }

  return undefined;
}
