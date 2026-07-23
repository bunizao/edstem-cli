import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from "jose";

export interface AccessConfig {
  accessAud: string;
  accessTeamDomain: string;
  ownerEmail: string;
}

export interface AccessIdentity {
  email: string;
  expiresAt?: number;
  subject: string;
}

export type AccessFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export class AccessConfigurationError extends Error {
  constructor() {
    super("Cloudflare Access is not configured.");
    this.name = "AccessConfigurationError";
  }
}

export class AccessUnauthorizedError extends Error {
  constructor() {
    super("Unauthorized.");
    this.name = "AccessUnauthorizedError";
  }
}

export async function verifyAccessAssertion(
  assertion: string,
  config: AccessConfig,
  fetch: AccessFetch = globalThis.fetch
): Promise<AccessIdentity> {
  const normalized = normalizeConfig(config);
  const jwks = createRemoteJWKSet(
    new URL("/cdn-cgi/access/certs", normalized.accessTeamDomain),
    {
      [customFetch]: (url, init) => fetch(url, init),
    }
  );

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(assertion, jwks, {
      audience: normalized.accessAud,
      issuer: normalized.accessTeamDomain,
      requiredClaims: ["email", "exp", "sub"],
    }));
  } catch {
    throw new AccessUnauthorizedError();
  }

  const email = normalizeEmail(payload.email);
  if (!email || email !== normalized.ownerEmail || typeof payload.sub !== "string") {
    throw new AccessUnauthorizedError();
  }

  return {
    email,
    expiresAt: payload.exp,
    subject: payload.sub,
  };
}

function normalizeConfig(config: AccessConfig): AccessConfig {
  const accessAud = config.accessAud.trim();
  const ownerEmail = normalizeEmail(config.ownerEmail);
  let accessTeamDomain: string;

  try {
    const url = new URL(config.accessTeamDomain.trim());
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("invalid team domain");
    }
    accessTeamDomain = url.origin;
  } catch {
    throw new AccessConfigurationError();
  }

  if (!accessAud || !ownerEmail) {
    throw new AccessConfigurationError();
  }

  return { accessAud, accessTeamDomain, ownerEmail };
}

function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const email = value.trim().toLowerCase();
  return email || undefined;
}
