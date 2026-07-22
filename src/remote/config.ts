const DEFAULT_API_BASE_URL = "https://edstem.org/api/";
const DEFAULT_DATABASE_PATH = ".data/edstem-mcp.db";
const DEFAULT_FIXED_CLIENT_NAME = "Claude Remote Connector";
const DEFAULT_FIXED_CLIENT_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const DEFAULT_READ_SCOPE = "mcp:tools.read";
const DEFAULT_WRITE_SCOPE = "mcp:tools.write";

function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_API_BASE_URL;
  }
  return `${trimmed.replace(/\/+$/, "")}/`;
}

function parsePort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 8787;
  }
  return parsed;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizePath(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function parseUrl(value: string | undefined, fallback: string): URL {
  return new URL(value?.trim() || fallback);
}

function parseUrlList(
  name: string,
  value: string | undefined,
  fallback: string[]
): string[] {
  const rawValues = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const entries = rawValues && rawValues.length > 0 ? rawValues : fallback;

  return entries.map((entry) => {
    try {
      return new URL(entry).toString();
    } catch {
      throw new Error(`${name} must contain valid absolute URLs`);
    }
  });
}

function parseMasterKey(name: string, value: string | undefined): Buffer | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(trimmed, "base64");
  } catch {
    throw new Error(`${name} must be a valid base64 string`);
  }

  if (buffer.length !== 32) {
    throw new Error(`${name} must decode to exactly 32 bytes`);
  }

  return buffer;
}

export interface OAuthConfig {
  accessTokenTtlSeconds: number;
  enabled: boolean;
  fixedClient?: StaticOAuthClientConfig;
  issuerUrl: URL;
  mcpServerUrl: URL;
  readScope: string;
  refreshTokenTtlSeconds: number;
  sessionCookieName: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
  supportedScopes: string[];
  writeScope: string;
}

export interface StaticOAuthClientConfig {
  clientId: string;
  clientName: string;
  clientSecret: string;
  redirectUris: string[];
}

export interface AppConfig {
  apiBaseUrl: string;
  dbCleanupIntervalSeconds: number;
  databasePath: string;
  devEdApiToken?: string;
  logLevel: "debug" | "info" | "warn" | "error";
  masterKey: Buffer;
  masterKeyPrevious?: Buffer;
  mcpPath: string;
  oauth: OAuthConfig;
  port: number;
  publicBaseUrl: URL;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env
): AppConfig {
  const port = parsePort(env.PORT);
  const mcpPath = normalizePath(env.MCP_PATH, "/mcp");
  const publicBaseUrl = parseUrl(env.PUBLIC_BASE_URL, `http://localhost:${port}`);
  const masterKey = parseMasterKey("MASTER_KEY", env.MASTER_KEY);

  if (!masterKey) {
    throw new Error("MASTER_KEY is required");
  }

  const readScope = env.OAUTH_READ_SCOPE?.trim() || DEFAULT_READ_SCOPE;
  const writeScope = env.OAUTH_WRITE_SCOPE?.trim() || DEFAULT_WRITE_SCOPE;
  const sessionSecret =
    env.OAUTH_SESSION_SECRET?.trim() || masterKey.toString("base64url");
  const fixedClient = parseFixedOAuthClient(env);

  return {
    apiBaseUrl: normalizeApiBaseUrl(env.ED_API_BASE_URL),
    dbCleanupIntervalSeconds: parsePositiveInt(env.DB_CLEANUP_INTERVAL_SECONDS, 900),
    databasePath: env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH,
    devEdApiToken: env.ED_API_TOKEN?.trim() || undefined,
    logLevel:
      (env.LOG_LEVEL?.trim().toLowerCase() as AppConfig["logLevel"] | undefined) ||
      "info",
    masterKey,
    masterKeyPrevious: parseMasterKey("MASTER_KEY_PREVIOUS", env.MASTER_KEY_PREVIOUS),
    mcpPath,
    oauth: {
      accessTokenTtlSeconds: parsePositiveInt(
        env.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
        3600
      ),
      enabled: parseBoolean(env.OAUTH_ENABLED, true),
      fixedClient,
      issuerUrl: parseUrl(env.OAUTH_ISSUER_URL, publicBaseUrl.href),
      mcpServerUrl: new URL(mcpPath, publicBaseUrl),
      readScope,
      refreshTokenTtlSeconds: parsePositiveInt(
        env.OAUTH_REFRESH_TOKEN_TTL_SECONDS,
        2592000
      ),
      sessionCookieName: env.OAUTH_SESSION_COOKIE_NAME?.trim() || "edstem_mcp_session",
      sessionSecret,
      sessionTtlSeconds: parsePositiveInt(env.OAUTH_SESSION_TTL_SECONDS, 604800),
      supportedScopes: [readScope, writeScope],
      writeScope
    },
    port,
    publicBaseUrl
  };
}

function parseFixedOAuthClient(
  env: Record<string, string | undefined>
): StaticOAuthClientConfig | undefined {
  const clientId = env.OAUTH_FIXED_CLIENT_ID?.trim();
  const clientSecret = env.OAUTH_FIXED_CLIENT_SECRET?.trim();

  if (!clientId && !clientSecret) {
    return undefined;
  }

  if (!clientId || !clientSecret) {
    throw new Error(
      "OAUTH_FIXED_CLIENT_ID and OAUTH_FIXED_CLIENT_SECRET must both be set"
    );
  }

  return {
    clientId,
    clientName: env.OAUTH_FIXED_CLIENT_NAME?.trim() || DEFAULT_FIXED_CLIENT_NAME,
    clientSecret,
    redirectUris: parseUrlList(
      "OAUTH_FIXED_CLIENT_REDIRECT_URIS",
      env.OAUTH_FIXED_CLIENT_REDIRECT_URIS,
      [DEFAULT_FIXED_CLIENT_REDIRECT_URI]
    )
  };
}
