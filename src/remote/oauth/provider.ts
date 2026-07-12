import { randomBytes, randomUUID } from "node:crypto";

import {
  checkResourceAllowed,
  resourceUrlFromServerUrl
} from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  AccessDeniedError,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import type { AppConfig, OAuthConfig } from "../config.js";
import { CredentialsService, EdNotConnectedError, EdReconnectRequiredError } from "../credentials/service.js";
import {
  EdApiBaseUrlError,
  EdTokenInvalidError,
  verifyEdToken
} from "../credentials/verifier.js";
import type { Logger } from "../logger.js";
import { UsersService } from "../users/service.js";
import { renderAuthorizePage as renderAuthorizeHtml } from "./login-page.js";
import type { AuthorizeResponse } from "./http.js";
import {
  buildSessionCookie,
  createSessionForUser,
  readSessionStateFromCookieHeader
} from "./session.js";
import {
  buildCsrfCookie,
  ensureCsrfToken,
  validateCsrfToken
} from "./csrf.js";
import {
  SqlOAuthStore,
  type AccessTokenRecord,
  type AuthorizationCodeRecord,
  type RefreshTokenRecord
} from "./sql-store.js";

const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;

class TosConsentRequiredError extends Error {
  constructor() {
    super("You must agree to the Terms of Service before continuing.");
    this.name = "TosConsentRequiredError";
  }
}

export class SqlOAuthClientsStore implements OAuthRegisteredClientsStore {
  constructor(private readonly store: SqlOAuthStore) {}

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.store.getClient(clientId);
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">
  ): Promise<OAuthClientInformationFull> {
    const registeredClient: OAuthClientInformationFull = {
      ...client,
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000)
    };
    this.store.saveClient(registeredClient);
    return registeredClient;
  }
}

export class EdstemOAuthProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  readonly skipLocalPkceValidation = false;
  private readonly config: OAuthConfig;
  private readonly apiBaseUrl: string;
  private readonly credentials: CredentialsService;
  private readonly logger: Logger;
  private readonly resourceUrl: URL;
  private readonly store: SqlOAuthStore;
  private readonly users: UsersService;

  constructor(dependencies: {
    config: AppConfig;
    credentials: CredentialsService;
    logger: Logger;
    store: SqlOAuthStore;
    users: UsersService;
  }) {
    this.config = dependencies.config.oauth;
    this.apiBaseUrl = dependencies.config.apiBaseUrl;
    this.credentials = dependencies.credentials;
    this.logger = dependencies.logger;
    this.resourceUrl = resourceUrlFromServerUrl(this.config.mcpServerUrl);
    this.store = dependencies.store;
    this.users = dependencies.users;
    this.clientsStore = new SqlOAuthClientsStore(this.store);
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: AuthorizeResponse
  ): Promise<void> {
    const request = res.req;
    const sessionState = readSessionStateFromCookieHeader(request.headers.cookie, this.config);
    const session = sessionState.session;
    const requestedScopes = normalizeRequestedScopes(params.scopes, this.config);
    const canReuseSession = session ? canContinueWithSession(this.credentials, session.userId) : false;
    const csrf = ensureCsrfToken(request.headers.cookie);

    if (csrf.cookie) {
      res.setHeader("Set-Cookie", buildCsrfCookie(this.config, csrf.cookie));
    }

    if (request.method !== "POST") {
      res
        .status(200)
        .type("html")
        .send(
          renderAuthorizePage(
            client,
            params,
            requestedScopes,
            csrf.token,
            session,
            {
              edTokenHint: "",
              showEdToken: !canReuseSession
            }
          )
        );
      return;
    }

    if (!validateCsrfToken(request.headers.cookie, getFormField(request.body?.csrf_token))) {
      res.status(403).type("html").send(
        renderAuthorizePage(
          client,
          params,
          requestedScopes,
          csrf.token,
          session,
          {
            edTokenHint: "",
            errorMessage: "Your session expired. Reload the page and try again.",
            showEdToken: !canReuseSession
          }
        )
      );
      return;
    }

    try {
      const result = await this.handleAuthorizationPost(request.body, requestedScopes, session);
      const nextSession = result.user;
      res.appendHeader("Set-Cookie", buildSessionCookie(nextSession, this.config));
      this.logger.info(
        {
          clientId: client.client_id,
          event: "oauth.authorize.approved",
          grantedScopes: result.grantedScopes,
          requestedScopes,
          userId: nextSession.userId
        },
        "oauth authorize approved"
      );
      await this.finishAuthorization(client, params, nextSession, result.grantedScopes, res);
    } catch (error) {
      const message = mapAuthorizeErrorMessage(error);
      const statusCode = mapAuthorizeStatusCode(error);

      this.logger.warn(
        {
          clientId: client.client_id,
          errorCode: mapAuthorizeAuditReason(error),
          event: "oauth.authorize.denied",
          requestedScopes,
          statusCode,
          userId: session?.userId
        },
        "oauth authorize denied"
      );

      res.status(statusCode).type("html").send(
        renderAuthorizePage(
          client,
          params,
          requestedScopes,
          csrf.token,
            sessionState.reason === "valid" ? session : null,
            {
              edTokenHint: mapEdTokenHint(error, session),
              errorMessage: message,
              showEdToken: shouldShowEdToken(error, session, canReuseSession)
            }
          )
      );
    }
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const record = this.store.getAuthorizationCode(authorizationCode);
    if (!record || record.clientId !== client.client_id || record.expiresAt <= Date.now()) {
      throw new InvalidGrantError("Invalid authorization code");
    }
    return record.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    const record = this.store.getAuthorizationCode(authorizationCode);
    if (!record) {
      throw new InvalidGrantError("Invalid authorization code");
    }
    if (record.clientId !== client.client_id) {
      throw new InvalidGrantError("Authorization code was issued to a different client");
    }
    if (record.expiresAt <= Date.now()) {
      this.store.deleteAuthorizationCode(authorizationCode);
      throw new InvalidGrantError("Authorization code has expired");
    }
    if (redirectUri && redirectUri !== record.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }

    const tokenResource = this.resolveResource(resource, record.resource);
    this.store.deleteAuthorizationCode(authorizationCode);
    return this.issueTokens(
      {
        clientId: client.client_id,
        displayName: record.displayName,
        resource: tokenResource?.href,
        scopes: record.scopes,
        userId: record.userId,
        username: record.username
      },
      true
    );
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const record = this.store.getRefreshToken(refreshToken);
    if (!record) {
      throw new InvalidGrantError("Invalid refresh token");
    }
    if (record.clientId !== client.client_id) {
      throw new InvalidGrantError("Refresh token was issued to a different client");
    }
    if (record.expiresAt <= Date.now()) {
      this.store.deleteRefreshToken(refreshToken);
      throw new InvalidGrantError("Refresh token has expired");
    }

    const nextScopes = scopes?.length ? validateScopes(scopes, record.scopes) : record.scopes;
    const tokenResource = this.resolveResource(resource, record.resource);

    this.store.deleteRefreshToken(refreshToken);
    return this.issueTokens(
      {
        clientId: client.client_id,
        displayName: record.displayName,
        resource: tokenResource?.href,
        scopes: nextScopes,
        userId: record.userId,
        username: record.username
      },
      true
    );
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    this.store.pruneExpired();
    const record = this.store.getAccessToken(token);
    if (!record || record.expiresAt <= Date.now()) {
      throw new InvalidGrantError("Invalid or expired access token");
    }

    return {
      clientId: record.clientId,
      expiresAt: Math.floor(record.expiresAt / 1000),
      extra: {
        displayName: record.displayName,
        email: this.users.getById(record.userId).email,
        userId: record.userId
      },
      resource: record.resource ? new URL(record.resource) : undefined,
      scopes: record.scopes,
      token
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    const accessToken = this.store.getAccessToken(request.token);
    if (accessToken && accessToken.clientId === client.client_id) {
      this.store.deleteAccessToken(request.token);
      return;
    }

    const refreshToken = this.store.getRefreshToken(request.token);
    if (refreshToken && refreshToken.clientId === client.client_id) {
      this.store.deleteRefreshToken(request.token);
    }
  }

  private async finishAuthorization(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    session: {
      displayName: string;
      email: string;
      expiresAt: number;
      userId: number;
    },
    scopes: string[],
    res: AuthorizeResponse
  ): Promise<void> {
    const code = randomUUID();
    const resource = this.resolveResource(params.resource);
    const now = Date.now();
    const record: AuthorizationCodeRecord = {
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      displayName: session.displayName,
      expiresAt: now + AUTHORIZATION_CODE_TTL_MS,
      issuedAt: now,
      redirectUri: params.redirectUri,
      resource: resource?.href,
      scopes,
      userId: session.userId,
      username: session.email
    };

    this.store.saveAuthorizationCode(code, record);
    res.redirect(302, buildAuthorizeRedirectUrl(params.redirectUri, code, params.state));
  }

  private async issueTokens(
    input: {
      clientId: string;
      displayName: string;
      resource?: string;
      scopes: string[];
      userId: number;
      username: string;
    },
    includeRefreshToken: boolean
  ): Promise<OAuthTokens> {
    const now = Date.now();
    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = includeRefreshToken
      ? randomBytes(32).toString("base64url")
      : undefined;

    const accessRecord: AccessTokenRecord = {
      clientId: input.clientId,
      displayName: input.displayName,
      expiresAt: now + this.config.accessTokenTtlSeconds * 1000,
      issuedAt: now,
      refreshToken,
      resource: input.resource,
      scopes: input.scopes,
      userId: input.userId,
      username: input.username
    };
    this.store.saveAccessToken(accessToken, accessRecord);

    if (refreshToken) {
      const refreshRecord: RefreshTokenRecord = {
        clientId: input.clientId,
        displayName: input.displayName,
        expiresAt: now + this.config.refreshTokenTtlSeconds * 1000,
        issuedAt: now,
        resource: input.resource,
        scopes: input.scopes,
        userId: input.userId,
        username: input.username
      };
      this.store.saveRefreshToken(refreshToken, refreshRecord);
    }

    return {
      access_token: accessToken,
      expires_in: this.config.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: input.scopes.join(" "),
      token_type: "bearer"
    };
  }

  private async handleAuthorizationPost(
    body: Record<string, unknown> | undefined,
    requestedScopes: string[],
    existingSession: {
      displayName: string;
      email: string;
      expiresAt: number;
      userId: number;
    } | null
  ): Promise<{
    grantedScopes: string[];
    user: { displayName: string; email: string; expiresAt: number; userId: number };
  }> {
    if (getFormField(body?.accept_toc) !== "1") {
      throw new TosConsentRequiredError();
    }

    const edToken = getFormField(body?.ed_token);
    if (!edToken) {
      if (!existingSession || !canContinueWithSession(this.credentials, existingSession.userId)) {
        throw new EdTokenInvalidError("An Ed API token is required to continue.");
      }

      const user = this.users.getById(existingSession.userId);
      return {
        grantedScopes: selectGrantedScopes(requestedScopes, body),
        user: createSessionForUser(user, this.config.sessionTtlSeconds)
      };
    }

    const verified = await verifyEdToken(edToken, this.apiBaseUrl);
    const user = this.users.upsertFromEdIdentity(verified);
    this.credentials.connectVerified(user.id, edToken, verified);

    return {
      grantedScopes: selectGrantedScopes(requestedScopes, body),
      user: createSessionForUser(user, this.config.sessionTtlSeconds)
    };
  }

  private resolveResource(resource?: URL, fallback?: string): URL | undefined {
    if (resource) {
      if (
        !checkResourceAllowed({
          configuredResource: this.resourceUrl,
          requestedResource: resource
        })
      ) {
        throw new InvalidTargetError("Requested resource is not allowed");
      }
      return resourceUrlFromServerUrl(resource);
    }

    if (fallback) {
      return new URL(fallback);
    }

    return undefined;
  }
}

function selectGrantedScopes(requestedScopes: string[], body: Record<string, unknown> | undefined): string[] {
  const scopes = new Set<string>();
  scopes.add(requestedScopes[0] ?? "mcp:tools.read");
  if (requestedScopes.includes("mcp:tools.write") && getFormField(body?.scope_write) === "1") {
    scopes.add("mcp:tools.write");
  }
  return Array.from(scopes);
}

function normalizeRequestedScopes(scopes: string[] | undefined, config: OAuthConfig): string[] {
  const requested = scopes?.length ? scopes : [config.readScope];
  const allowed = new Set(config.supportedScopes);
  for (const scope of requested) {
    if (!allowed.has(scope)) {
      throw new InvalidScopeError(`Unsupported scope: ${scope}`);
    }
  }
  if (!requested.includes(config.readScope)) {
    throw new InvalidScopeError("Read scope is required");
  }
  return Array.from(new Set(requested));
}

function validateScopes(requested: string[], granted: string[]): string[] {
  if (requested.length === 0) {
    return granted;
  }

  const unknown = requested.find((scope) => !granted.includes(scope));
  if (unknown) {
    throw new InvalidScopeError("Requested scope exceeds the original grant");
  }

  return Array.from(new Set(requested));
}

function getFormField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function renderAuthorizePage(
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
  requestedScopes: string[],
  csrfToken: string,
  session: { displayName: string; email: string; expiresAt: number; userId: number } | null,
  options: {
    edTokenHint: string;
    errorMessage?: string;
    showEdToken: boolean;
  }
): string {
  return renderAuthorizeHtml(client, {
    csrfToken,
    edTokenHint: options.edTokenHint,
    errorMessage: options.errorMessage,
    params,
    requestedScopes,
    session: session
      ? {
          displayName: session.displayName,
          email: session.email
        }
      : undefined,
    showEdToken: options.showEdToken
  });
}

function buildAuthorizeRedirectUrl(
  redirectUri: string,
  code: string,
  state: string | undefined
): string {
  const redirectTarget = new URL(redirectUri);
  redirectTarget.searchParams.set("code", code);
  if (state) {
    redirectTarget.searchParams.set("state", state);
  }
  return redirectTarget.toString();
}

function mapAuthorizeErrorMessage(error: unknown): string {
  if (
    error instanceof TosConsentRequiredError ||
    error instanceof EdTokenInvalidError ||
    error instanceof EdApiBaseUrlError ||
    error instanceof EdNotConnectedError ||
    error instanceof EdReconnectRequiredError
  ) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function mapAuthorizeStatusCode(error: unknown): number {
  if (
    error instanceof TosConsentRequiredError ||
    error instanceof EdTokenInvalidError ||
    error instanceof EdApiBaseUrlError ||
    error instanceof EdNotConnectedError ||
    error instanceof EdReconnectRequiredError
  ) {
    return 422;
  }
  if (error instanceof AccessDeniedError) {
    return 403;
  }
  return 500;
}

function mapEdTokenHint(error: unknown, session: { email: string } | null): string {
  return "";
}

function shouldShowEdToken(
  error: unknown,
  session: { email: string } | null,
  canReuseSession: boolean
): boolean {
  if (error instanceof EdTokenInvalidError || error instanceof EdApiBaseUrlError) {
    return true;
  }
  return !session || !canReuseSession;
}

function mapAuthorizeAuditReason(error: unknown): string {
  if (error instanceof TosConsentRequiredError) {
    return "toc_not_accepted";
  }
  if (error instanceof EdTokenInvalidError) {
    return "invalid_ed_token";
  }
  if (error instanceof EdApiBaseUrlError) {
    return "invalid_api_base_url";
  }
  if (error instanceof EdNotConnectedError) {
    return "ed_not_connected";
  }
  if (error instanceof EdReconnectRequiredError) {
    return "ed_reconnect_required";
  }
  if (error instanceof AccessDeniedError) {
    return "access_denied";
  }
  if (error instanceof Error) {
    return error.name;
  }
  return "unknown_error";
}

function canContinueWithSession(credentials: CredentialsService, userId: number): boolean {
  const connection = credentials.getConnectionStatus(userId);
  return connection.connected && !connection.isInvalid;
}
