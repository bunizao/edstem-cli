import { randomBytes, randomUUID } from "node:crypto";

import {
  createOAuthMetadata,
  getOAuthProtectedResourceMetadataUrl
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  InvalidClientError,
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidRequestError,
  OAuthError,
  ServerError,
  TemporarilyUnavailableError,
  UnsupportedGrantTypeError
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import {
  OAuthClientMetadataSchema,
  type OAuthClientInformationFull
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { createRemoteMcpServer } from "./mcp-runtime.js";
import type { Runtime } from "./runtime.js";
import {
  buildCsrfCookie,
  buildExpiredCsrfCookie,
  ensureCsrfToken,
  validateCsrfToken
} from "./oauth/csrf.js";
import { BunAuthorizeResponse } from "./oauth/http.js";
import { renderAuthorizePage as renderAuthorizeHtml } from "./oauth/login-page.js";
import {
  buildSessionCookie,
  buildExpiredSessionCookie,
  createSessionForUser,
  readSessionStateFromCookieHeader
} from "./oauth/session.js";
import {
  EdIdentityMismatchError
} from "./users/service.js";
import { verifyEdToken } from "./credentials/verifier.js";

const AUTH_RATE_LIMIT = {
  limit: 20,
  windowMs: 15 * 60 * 1000
} as const;
const ROOT_PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

const CLIENT_REGISTRATION_RATE_LIMIT = {
  limit: 20,
  windowMs: 60 * 60 * 1000
} as const;

const MCP_RATE_LIMIT = {
  limit: 60,
  windowMs: 60 * 1000
} as const;

const TOKEN_RATE_LIMIT = {
  limit: 50,
  windowMs: 15 * 60 * 1000
} as const;

const AUTHORIZE_ATTEMPT_RATE_LIMIT = {
  limit: 5,
  windowMs: 15 * 60 * 1000
} as const;

const ED_TOKEN_ATTEMPT_RATE_LIMIT = {
  limit: 5,
  windowMs: 15 * 60 * 1000
} as const;

export interface BunApp {
  fetch(request: Request): Promise<Response>;
}

type RequestContext = {
  clientIp: string;
  requestId: string;
};

export function createApp(runtime: Runtime): BunApp {
  const authMetadataPath = "/.well-known/oauth-authorization-server";
  const protectedResourceMetadataPath = new URL(
    getOAuthProtectedResourceMetadataUrl(runtime.config.oauth.mcpServerUrl)
  ).pathname;
  const rateLimiter = createRateLimiter();
  const oauthMetadata = runtime.config.oauth.enabled
    ? createOAuthMetadata({
        issuerUrl: runtime.config.oauth.issuerUrl,
        provider: runtime.oauthProvider as unknown as OAuthServerProvider,
        scopesSupported: runtime.config.oauth.supportedScopes
      })
    : null;

  return {
    async fetch(request: Request): Promise<Response> {
      const startedAt = Date.now();
      const requestId = randomUUID();
      const clientIp = getClientIp(request);
      const context: RequestContext = {
        clientIp,
        requestId
      };
      let response: Response;

      try {
        response = await routeRequest(
          runtime,
          request,
          rateLimiter,
          context,
          authMetadataPath,
          protectedResourceMetadataPath,
          oauthMetadata
        );
      } catch (error) {
        runtime.logger.error(
          {
            clientIp,
            error: serializeError(error),
            method: request.method,
            requestId,
            url: request.url
          },
          "request failed"
        );
        response = createJsonResponse(
          {
            error: {
              message: error instanceof Error ? error.message : String(error)
            }
          },
          500
        );
      }

      response.headers.set("X-Request-Id", requestId);
      runtime.logger.info(
        {
          clientIp,
          durationMs: Date.now() - startedAt,
          method: request.method,
          requestId,
          statusCode: response.status,
          url: request.url
        },
        "request complete"
      );

      return response;
    }
  };
}

async function routeRequest(
  runtime: Runtime,
  request: Request,
  rateLimiter: RateLimiter,
  context: RequestContext,
  authMetadataPath: string,
  protectedResourceMetadataPath: string,
  oauthMetadata: Record<string, unknown> | null
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === "OPTIONS" && isCorsPath(pathname, runtime)) {
    return createCorsPreflightResponse();
  }

  if (pathname === "/healthz" && request.method === "GET") {
    return createJsonResponse({ ok: true, service: "edstem-mcp" });
  }

  if (pathname === "/readyz" && request.method === "GET") {
    return createJsonResponse({
      db: true,
      key: runtime.config.masterKey.length === 32,
      ok: true
    });
  }

  if (runtime.config.oauth.enabled) {
    if (pathname === authMetadataPath && request.method === "GET" && oauthMetadata) {
      return createJsonResponse(oauthMetadata, 200, corsHeaders());
    }

    if (
      (pathname === protectedResourceMetadataPath ||
        pathname === ROOT_PROTECTED_RESOURCE_METADATA_PATH) &&
      request.method === "GET"
    ) {
      return createJsonResponse(
        {
          authorization_servers: [runtime.config.oauth.issuerUrl.href],
          bearer_methods_supported: ["header"],
          resource: runtime.config.oauth.mcpServerUrl.href,
          resource_name: "EdStem MCP",
          scopes_supported: runtime.config.oauth.supportedScopes
        },
        200,
        corsHeaders()
      );
    }

    if (pathname === "/register") {
      return handleClientRegistration(runtime, request, rateLimiter, context);
    }

    if (pathname === "/token") {
      return handleToken(runtime, request, rateLimiter, context);
    }

    if (pathname === "/revoke") {
      return handleRevoke(runtime, request, rateLimiter, context);
    }

    if (pathname === "/authorize") {
      return handleAuthorize(runtime, request, rateLimiter, context);
    }
  }

  if (pathname === "/settings" && request.method === "GET") {
    return handleSettings(runtime, request);
  }

  if (pathname === "/settings/rotate" && request.method === "POST") {
    return handleSettingsRotate(runtime, request, rateLimiter, context);
  }

  if (pathname === "/settings/delete" && request.method === "POST") {
    return handleSettingsDelete(runtime, request);
  }

  if (pathname === "/reconnect" && request.method === "GET") {
    return handleReconnect(runtime, request);
  }

  if (pathname === "/reconnect" && request.method === "POST") {
    return handleReconnectSubmit(runtime, request, rateLimiter, context);
  }

  if (pathname === runtime.config.mcpPath) {
    return handleMcp(runtime, request, rateLimiter, context);
  }

  return new Response("Not found", { status: 404 });
}

async function handleAuthorize(
  runtime: Runtime,
  request: Request,
  rateLimiter: RateLimiter,
  context: RequestContext
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return createOAuthErrorResponse(new InvalidRequestError("Method not allowed"), 405);
  }

  const form = request.method === "POST" ? await parseFormBody(request) : undefined;
  const source =
    request.method === "POST"
      ? (form ?? {})
      : Object.fromEntries(new URL(request.url).searchParams.entries());

  try {
    const clientId = requiredField(source.client_id, "client_id");
    const responseType = requiredField(source.response_type, "response_type");
    const codeChallenge = requiredField(source.code_challenge, "code_challenge");
    const codeChallengeMethod = requiredField(
      source.code_challenge_method,
      "code_challenge_method"
    );

    if (responseType !== "code") {
      throw new InvalidRequestError("response_type must be code");
    }
    if (codeChallengeMethod !== "S256") {
      throw new InvalidRequestError("code_challenge_method must be S256");
    }

    const client = await runtime.oauthProvider.clientsStore.getClient(clientId);
    if (!client) {
      throw new InvalidClientError("Invalid client_id");
    }

    const requestedScopes = parseRequestedScopes(source.scope, runtime.config);
    const sessionState = readSessionStateFromCookieHeader(
      request.headers.get("cookie") ?? undefined,
      runtime.config.oauth
    );
    const redirectUri = resolveRedirectUri(client, source.redirect_uri);
    const response = new BunAuthorizeResponse({
      body: form,
      headers: {
        cookie: request.headers.get("cookie") ?? undefined
      },
      method: request.method
    });
    if (sessionState.reason === "expired" || sessionState.reason === "invalid") {
      response.appendHeader("Set-Cookie", buildExpiredSessionCookie(runtime.config.oauth));
    }

    const authorizeKey = requestKey(request, "authorize");
    if (!rateLimiter.allow(authorizeKey, AUTH_RATE_LIMIT)) {
      const limitState = rateLimiter.inspect(authorizeKey, AUTH_RATE_LIMIT);
      runtime.logger.warn(
        {
          attemptKey: authorizeKey,
          clientId,
          clientIp: context.clientIp,
          event: "oauth.authorize.throttled",
          limit: limitState.limit,
          remaining: limitState.remaining,
          requestMethod: request.method,
          requestId: context.requestId,
          resetInSec: Math.ceil(limitState.resetInMs / 1000),
          sessionReason: sessionState.reason,
          windowMs: AUTH_RATE_LIMIT.windowMs
        },
        "oauth authorize throttled"
      );
      return createAuthorizeRateLimitResponse(
        runtime,
        client,
        {
          codeChallenge,
          redirectUri,
          resource: source.resource ? new URL(source.resource) : undefined,
          scopes: requestedScopes,
          state: source.state
        },
        form,
        request.method === "POST" ? sessionState : { reason: "missing", session: null },
        request.headers.get("cookie") ?? undefined,
        AUTH_RATE_LIMIT
      );
    }

    const attemptKey = buildAuthorizeAttemptKey(request, sessionState.session);
    if (request.method === "POST" && !rateLimiter.allow(attemptKey, AUTHORIZE_ATTEMPT_RATE_LIMIT)) {
      const limitState = rateLimiter.inspect(attemptKey, AUTHORIZE_ATTEMPT_RATE_LIMIT);
      runtime.logger.warn(
        {
          clientId,
          clientIp: context.clientIp,
          attemptKey,
          attemptScope: sessionState.session ? "user" : "ip",
          event: "oauth.authorize.attempt_throttled",
          hasEdToken: Boolean(form?.ed_token?.trim()),
          hasTosConsent: form?.accept_toc === "1",
          limit: limitState.limit,
          remaining: limitState.remaining,
          requestId: context.requestId,
          resetInSec: Math.ceil(limitState.resetInMs / 1000),
          sessionReason: sessionState.reason,
          sessionUserId: sessionState.session?.userId,
          windowMs: AUTHORIZE_ATTEMPT_RATE_LIMIT.windowMs
        },
        "oauth authorize attempt throttled"
      );
      return createAuthorizeRateLimitResponse(
        runtime,
        client,
        {
          codeChallenge,
          redirectUri,
          resource: source.resource ? new URL(source.resource) : undefined,
          scopes: requestedScopes,
          state: source.state
        },
        form,
        sessionState,
        request.headers.get("cookie") ?? undefined,
        AUTHORIZE_ATTEMPT_RATE_LIMIT
      );
    }

    await runtime.oauthProvider.authorize(
      client,
      {
        codeChallenge,
        redirectUri,
        resource: source.resource ? new URL(source.resource) : undefined,
        scopes: requestedScopes,
        state: source.state
      },
      response
    );

    return response.toResponse();
  } catch (error) {
    if (error instanceof OAuthError) {
      runtime.logger.warn(
        {
          clientIp: context.clientIp,
          error: serializeError(error),
          event: "oauth.authorize.failed",
          requestId: context.requestId
        },
        "oauth authorize failed"
      );
      return createOAuthErrorResponse(error);
    }
    runtime.logger.error(
      {
        clientIp: context.clientIp,
        error: serializeError(error),
        event: "oauth.authorize.crashed",
        requestId: context.requestId
      },
      "oauth authorize crashed"
    );
    const serverError = new ServerError(error instanceof Error ? error.message : String(error));
    return createOAuthErrorResponse(serverError, 500);
  }
}

async function handleClientRegistration(
  runtime: Runtime,
  request: Request,
  rateLimiter: RateLimiter,
  context: RequestContext
): Promise<Response> {
  if (request.method !== "POST") {
    return createOAuthErrorResponse(new InvalidRequestError("Method not allowed"), 405, corsHeaders());
  }

  if (!rateLimiter.allow(requestKey(request, "register"), CLIENT_REGISTRATION_RATE_LIMIT)) {
    runtime.logger.warn(
      {
        clientIp: context.clientIp,
        event: "oauth.client_registration.throttled",
        requestId: context.requestId
      },
      "oauth client registration throttled"
    );
    return createOAuthErrorResponse(
      new TemporarilyUnavailableError("Too many client registration attempts."),
      429,
      withRetryAfterHeaders(CLIENT_REGISTRATION_RATE_LIMIT, corsHeaders())
    );
  }

  try {
    const body = (await request.json()) as unknown;
    const parsed = OAuthClientMetadataSchema.safeParse(body);
    if (!parsed.success) {
      throw new InvalidClientMetadataError(parsed.error.message);
    }

    const metadata = parsed.data;
    const isPublicClient = metadata.token_endpoint_auth_method === "none";
    const issuedAt = Math.floor(Date.now() / 1000);
    const registerClient = runtime.oauthProvider.clientsStore.registerClient;
    if (!registerClient) {
      throw new ServerError("Client registration is not supported");
    }

    const client: OAuthClientInformationFull = await registerClient.call(
      runtime.oauthProvider.clientsStore,
      {
        ...metadata,
        client_secret: isPublicClient ? undefined : randomBytes(32).toString("hex"),
        client_secret_expires_at: isPublicClient ? undefined : issuedAt + 30 * 24 * 60 * 60
      }
    );

    runtime.logger.info(
      {
        clientId: client.client_id,
        clientIp: context.clientIp,
        event: "oauth.client_registration.created",
        requestId: context.requestId
      },
      "oauth client registered"
    );

    return createJsonResponse(client, 201, corsHeaders({ "Cache-Control": "no-store" }));
  } catch (error) {
    runtime.logger.warn(
      {
        clientIp: context.clientIp,
        error: serializeError(error),
        event: "oauth.client_registration.failed",
        requestId: context.requestId
      },
      "oauth client registration failed"
    );
    if (error instanceof OAuthError) {
      return createOAuthErrorResponse(error, undefined, corsHeaders());
    }
    const serverError = new ServerError(error instanceof Error ? error.message : String(error));
    return createOAuthErrorResponse(serverError, 500, corsHeaders());
  }
}

async function handleToken(
  runtime: Runtime,
  request: Request,
  rateLimiter: RateLimiter,
  context: RequestContext
): Promise<Response> {
  if (request.method !== "POST") {
    return createOAuthErrorResponse(new InvalidRequestError("Method not allowed"), 405, corsHeaders());
  }

  if (!rateLimiter.allow(requestKey(request, "token"), TOKEN_RATE_LIMIT)) {
    runtime.logger.warn(
      {
        clientIp: context.clientIp,
        event: "oauth.token.throttled",
        requestId: context.requestId
      },
      "oauth token throttled"
    );
    return createOAuthErrorResponse(
      new TemporarilyUnavailableError("Too many token requests."),
      429,
      withRetryAfterHeaders(TOKEN_RATE_LIMIT, corsHeaders())
    );
  }

  try {
    const body = await parseFormBody(request);
    const client = await authenticateClient(runtime, request, body);
    const grantType = requiredField(body.grant_type, "grant_type");

    switch (grantType) {
      case "authorization_code": {
        const code = requiredField(body.code, "code");
        const codeVerifier = requiredField(body.code_verifier, "code_verifier");

        if (!runtime.oauthProvider.skipLocalPkceValidation) {
          const codeChallenge = await runtime.oauthProvider.challengeForAuthorizationCode(client, code);
          const valid = await verifyPkceChallenge(codeVerifier, codeChallenge);
          if (!valid) {
            throw new InvalidGrantError("code_verifier does not match the challenge");
          }
        }

        const tokens = await runtime.oauthProvider.exchangeAuthorizationCode(
          client,
          code,
          runtime.oauthProvider.skipLocalPkceValidation ? codeVerifier : undefined,
          body.redirect_uri,
          body.resource ? new URL(body.resource) : undefined
        );
        runtime.logger.info(
          {
            clientId: client.client_id,
            clientIp: context.clientIp,
            event: "oauth.token.issued",
            grantType,
            requestId: context.requestId
          },
          "oauth token issued"
        );
        return createJsonResponse(tokens, 200, corsHeaders({ "Cache-Control": "no-store" }));
      }

      case "refresh_token": {
        const refreshToken = requiredField(body.refresh_token, "refresh_token");
        const tokens = await runtime.oauthProvider.exchangeRefreshToken(
          client,
          refreshToken,
          body.scope ? body.scope.split(" ").filter(Boolean) : undefined,
          body.resource ? new URL(body.resource) : undefined
        );
        runtime.logger.info(
          {
            clientId: client.client_id,
            clientIp: context.clientIp,
            event: "oauth.token.refreshed",
            grantType,
            requestId: context.requestId
          },
          "oauth token refreshed"
        );
        return createJsonResponse(tokens, 200, corsHeaders({ "Cache-Control": "no-store" }));
      }

      default:
        throw new UnsupportedGrantTypeError("Unsupported grant type");
    }
  } catch (error) {
    runtime.logger.warn(
      {
        clientIp: context.clientIp,
        error: serializeError(error),
        event: "oauth.token.failed",
        requestId: context.requestId
      },
      "oauth token failed"
    );
    if (error instanceof OAuthError) {
      return createOAuthErrorResponse(error, undefined, corsHeaders());
    }
    const serverError = new ServerError(error instanceof Error ? error.message : String(error));
    return createOAuthErrorResponse(serverError, 500, corsHeaders());
  }
}

async function handleRevoke(
  runtime: Runtime,
  request: Request,
  rateLimiter: RateLimiter,
  context: RequestContext
): Promise<Response> {
  if (request.method !== "POST") {
    return createOAuthErrorResponse(new InvalidRequestError("Method not allowed"), 405, corsHeaders());
  }

  if (!rateLimiter.allow(requestKey(request, "revoke"), TOKEN_RATE_LIMIT)) {
    runtime.logger.warn(
      {
        clientIp: context.clientIp,
        event: "oauth.revoke.throttled",
        requestId: context.requestId
      },
      "oauth revoke throttled"
    );
    return createOAuthErrorResponse(
      new TemporarilyUnavailableError("Too many token revocation attempts."),
      429,
      withRetryAfterHeaders(TOKEN_RATE_LIMIT, corsHeaders())
    );
  }

  try {
    const body = await parseFormBody(request);
    const client = await authenticateClient(runtime, request, body);
    const token = requiredField(body.token, "token");

    if (runtime.oauthProvider.revokeToken) {
      await runtime.oauthProvider.revokeToken(client, { token });
    }

    runtime.logger.info(
      {
        clientId: client.client_id,
        clientIp: context.clientIp,
        event: "oauth.revoke.completed",
        requestId: context.requestId
      },
      "oauth token revoked"
    );

    return new Response(null, {
      headers: corsHeaders({ "Cache-Control": "no-store" }),
      status: 200
    });
  } catch (error) {
    runtime.logger.warn(
      {
        clientIp: context.clientIp,
        error: serializeError(error),
        event: "oauth.revoke.failed",
        requestId: context.requestId
      },
      "oauth revoke failed"
    );
    if (error instanceof OAuthError) {
      return createOAuthErrorResponse(error, undefined, corsHeaders());
    }
    const serverError = new ServerError(error instanceof Error ? error.message : String(error));
    return createOAuthErrorResponse(serverError, 500, corsHeaders());
  }
}

async function handleMcp(
  runtime: Runtime,
  request: Request,
  rateLimiter: RateLimiter,
  context: RequestContext
): Promise<Response> {
  if (!rateLimiter.allow(requestKey(request, "mcp"), MCP_RATE_LIMIT)) {
    runtime.logger.warn(
      {
        clientIp: context.clientIp,
        event: "mcp.throttled",
        requestId: context.requestId
      },
      "mcp throttled"
    );
    return createJsonResponse(
      {
        error: {
          message: "Rate limit exceeded."
        }
      },
      429,
      withRetryAfterHeaders(MCP_RATE_LIMIT)
    );
  }

  let authInfo: AuthInfo | undefined;
  if (runtime.config.oauth.enabled) {
    const auth = await authenticateBearerRequest(runtime, request);
    if (auth instanceof Response) {
      return auth;
    }
    authInfo = auth;
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined
  });
  const server = createRemoteMcpServer(runtime);
  await server.connect(transport);
  return transport.handleRequest(request, { authInfo });
}

function handleSettings(runtime: Runtime, request: Request): Response {
  const sessionState = readSessionStateFromCookieHeader(
    request.headers.get("cookie") ?? undefined,
    runtime.config.oauth
  );
  const session = sessionState.session;
  const headers = new Headers();

  if (!session) {
    appendSessionCleanupCookies(headers, runtime.config.oauth, sessionState.reason);
    return createHtmlResponse(
      renderSessionRequiredPage("settings", sessionState.reason),
      401,
      headers
    );
  }

  const csrf = ensureCsrfToken(request.headers.get("cookie") ?? undefined);
  if (csrf.cookie) {
    headers.append("Set-Cookie", buildCsrfCookie(runtime.config.oauth, csrf.cookie));
  }

  return createHtmlResponse(
    renderSettingsPage({
      csrfToken: csrf.token,
      session,
      status: runtime.credentials.getConnectionStatus(session.userId)
    }),
    200,
    headers
  );
}

async function handleSettingsRotate(
  runtime: Runtime,
  request: Request,
  rateLimiter: RateLimiter,
  context: RequestContext
): Promise<Response> {
  const sessionState = readSessionStateFromCookieHeader(
    request.headers.get("cookie") ?? undefined,
    runtime.config.oauth
  );
  const session = sessionState.session;
  const headers = new Headers();

  if (!session) {
    appendSessionCleanupCookies(headers, runtime.config.oauth, sessionState.reason);
    return createHtmlResponse(
      renderSessionRequiredPage("settings", sessionState.reason),
      401,
      headers
    );
  }

  const csrf = ensureCsrfToken(request.headers.get("cookie") ?? undefined);
  if (csrf.cookie) {
    headers.append("Set-Cookie", buildCsrfCookie(runtime.config.oauth, csrf.cookie));
  }

  const body = await parseFormBody(request);
  if (!validateCsrfToken(request.headers.get("cookie") ?? undefined, body.csrf_token)) {
    return createHtmlResponse(
      renderSettingsPage({
        csrfToken: csrf.token,
        errorMessage: "Your session expired. Reload the page and try again.",
        session,
        status: runtime.credentials.getConnectionStatus(session.userId)
      }),
      403,
      headers
    );
  }

  const edToken = body.ed_token?.trim() || "";
  if (!edToken) {
    return createHtmlResponse(
      renderSettingsPage({
        csrfToken: csrf.token,
        errorMessage: "Ed API token is required.",
        session,
        status: runtime.credentials.getConnectionStatus(session.userId)
      }),
      422,
      headers
    );
  }

  if (
    !rateLimiter.allow(
      requestKey(request, "settings-rotate", String(session.userId)),
      ED_TOKEN_ATTEMPT_RATE_LIMIT
    )
  ) {
    runtime.logger.warn(
      {
        clientIp: context.clientIp,
        event: "settings.rotate.throttled",
        requestId: context.requestId,
        userId: session.userId
      },
      "settings rotate throttled"
    );
    return createHtmlResponse(
      renderSettingsPage({
        csrfToken: csrf.token,
        errorMessage: "Too many Ed token attempts. Wait a bit and try again.",
        session,
        status: runtime.credentials.getConnectionStatus(session.userId)
      }),
      429,
      withRetryAfterHeaders(ED_TOKEN_ATTEMPT_RATE_LIMIT, headers)
    );
  }

  try {
    const verified = await verifyEdToken(edToken, runtime.config.apiBaseUrl);
    const user = runtime.users.syncIdentity(session.userId, verified);
    runtime.credentials.connectVerified(user.id, edToken, verified);
    headers.append(
      "Set-Cookie",
      buildSessionCookie(
        createSessionForUser(user, runtime.config.oauth.sessionTtlSeconds),
        runtime.config.oauth
      )
    );
    runtime.logger.info(
      {
        clientIp: context.clientIp,
        event: "settings.rotate.succeeded",
        requestId: context.requestId,
        userId: session.userId
      },
      "settings rotate succeeded"
    );
    return redirectResponse("/settings", headers);
  } catch (error) {
    runtime.logger.warn(
      {
        clientIp: context.clientIp,
        error: serializeError(error),
        event: "settings.rotate.failed",
        requestId: context.requestId,
        userId: session.userId
      },
      "settings rotate failed"
    );
    return createHtmlResponse(
      renderSettingsPage({
        csrfToken: csrf.token,
        errorMessage: mapEdConnectionError(error),
        session,
        status: runtime.credentials.getConnectionStatus(session.userId)
      }),
      422,
      headers
    );
  }
}

async function handleSettingsDelete(runtime: Runtime, request: Request): Promise<Response> {
  const sessionState = readSessionStateFromCookieHeader(
    request.headers.get("cookie") ?? undefined,
    runtime.config.oauth
  );
  const session = sessionState.session;
  const headers = new Headers();

  if (!session) {
    appendSessionCleanupCookies(headers, runtime.config.oauth, sessionState.reason);
    return createHtmlResponse(
      renderSessionRequiredPage("settings", sessionState.reason),
      401,
      headers
    );
  }

  const csrf = ensureCsrfToken(request.headers.get("cookie") ?? undefined);
  if (csrf.cookie) {
    headers.append("Set-Cookie", buildCsrfCookie(runtime.config.oauth, csrf.cookie));
  }

  const body = await parseFormBody(request);
  if (!validateCsrfToken(request.headers.get("cookie") ?? undefined, body.csrf_token)) {
    return createHtmlResponse(
      renderSettingsPage({
        csrfToken: csrf.token,
        errorMessage: "Your session expired. Reload the page and try again.",
        session,
        status: runtime.credentials.getConnectionStatus(session.userId)
      }),
      403,
      headers
    );
  }

  runtime.credentials.delete(session.userId);
  runtime.users.deleteAccount(session.userId);
  headers.append("Set-Cookie", buildExpiredSessionCookie(runtime.config.oauth));
  headers.append("Set-Cookie", buildExpiredCsrfCookie(runtime.config.oauth));

  return createHtmlResponse(renderDeletedPage(), 200, headers);
}

function handleReconnect(runtime: Runtime, request: Request): Response {
  const sessionState = readSessionStateFromCookieHeader(
    request.headers.get("cookie") ?? undefined,
    runtime.config.oauth
  );
  const session = sessionState.session;
  const headers = new Headers();

  if (!session) {
    appendSessionCleanupCookies(headers, runtime.config.oauth, sessionState.reason);
    return createHtmlResponse(
      renderSessionRequiredPage("reconnect", sessionState.reason),
      401,
      headers
    );
  }

  const csrf = ensureCsrfToken(request.headers.get("cookie") ?? undefined);
  if (csrf.cookie) {
    headers.append("Set-Cookie", buildCsrfCookie(runtime.config.oauth, csrf.cookie));
  }

  return createHtmlResponse(
    renderReconnectPage({
      csrfToken: csrf.token,
      session,
      status: runtime.credentials.getConnectionStatus(session.userId)
    }),
    200,
    headers
  );
}

async function handleReconnectSubmit(
  runtime: Runtime,
  request: Request,
  rateLimiter: RateLimiter,
  context: RequestContext
): Promise<Response> {
  const sessionState = readSessionStateFromCookieHeader(
    request.headers.get("cookie") ?? undefined,
    runtime.config.oauth
  );
  const session = sessionState.session;
  const headers = new Headers();

  if (!session) {
    appendSessionCleanupCookies(headers, runtime.config.oauth, sessionState.reason);
    return createHtmlResponse(
      renderSessionRequiredPage("reconnect", sessionState.reason),
      401,
      headers
    );
  }

  const csrf = ensureCsrfToken(request.headers.get("cookie") ?? undefined);
  if (csrf.cookie) {
    headers.append("Set-Cookie", buildCsrfCookie(runtime.config.oauth, csrf.cookie));
  }

  const body = await parseFormBody(request);
  if (!validateCsrfToken(request.headers.get("cookie") ?? undefined, body.csrf_token)) {
    return createHtmlResponse(
      renderReconnectPage({
        csrfToken: csrf.token,
        errorMessage: "Your session expired. Reload the page and try again.",
        session,
        status: runtime.credentials.getConnectionStatus(session.userId)
      }),
      403,
      headers
    );
  }

  const edToken = body.ed_token?.trim() || "";
  if (!edToken) {
    return createHtmlResponse(
      renderReconnectPage({
        csrfToken: csrf.token,
        errorMessage: "Ed API token is required.",
        session,
        status: runtime.credentials.getConnectionStatus(session.userId)
      }),
      422,
      headers
    );
  }

  if (
    !rateLimiter.allow(
      requestKey(request, "reconnect", String(session.userId)),
      ED_TOKEN_ATTEMPT_RATE_LIMIT
    )
  ) {
    runtime.logger.warn(
      {
        clientIp: context.clientIp,
        event: "reconnect.throttled",
        requestId: context.requestId,
        userId: session.userId
      },
      "reconnect throttled"
    );
    return createHtmlResponse(
      renderReconnectPage({
        csrfToken: csrf.token,
        errorMessage: "Too many Ed token attempts. Wait a bit and try again.",
        session,
        status: runtime.credentials.getConnectionStatus(session.userId)
      }),
      429,
      withRetryAfterHeaders(ED_TOKEN_ATTEMPT_RATE_LIMIT, headers)
    );
  }

  try {
    const verified = await verifyEdToken(edToken, runtime.config.apiBaseUrl);
    const user = runtime.users.syncIdentity(session.userId, verified);
    runtime.credentials.connectVerified(user.id, edToken, verified);
    headers.append(
      "Set-Cookie",
      buildSessionCookie(
        createSessionForUser(user, runtime.config.oauth.sessionTtlSeconds),
        runtime.config.oauth
      )
    );
    runtime.logger.info(
      {
        clientIp: context.clientIp,
        event: "reconnect.succeeded",
        requestId: context.requestId,
        userId: session.userId
      },
      "reconnect succeeded"
    );
    return redirectResponse("/settings", headers);
  } catch (error) {
    runtime.logger.warn(
      {
        clientIp: context.clientIp,
        error: serializeError(error),
        event: "reconnect.failed",
        requestId: context.requestId,
        userId: session.userId
      },
      "reconnect failed"
    );
    return createHtmlResponse(
      renderReconnectPage({
        csrfToken: csrf.token,
        errorMessage: mapEdConnectionError(error),
        session,
        status: runtime.credentials.getConnectionStatus(session.userId)
      }),
      422,
      headers
    );
  }
}

async function authenticateBearerRequest(
  runtime: Runtime,
  request: Request
): Promise<AuthInfo | Response> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return unauthorizedResponse(runtime, "Bearer token is required.", "invalid_token");
  }

  try {
    const authInfo = await runtime.oauthProvider.verifyAccessToken(
      authorization.slice("Bearer ".length)
    );
    if (!authInfo.scopes.includes(runtime.config.oauth.readScope)) {
      return forbiddenResponse("Read scope is required.");
    }
    return authInfo;
  } catch (error) {
    return unauthorizedResponse(
      runtime,
      error instanceof Error ? error.message : "Invalid bearer token.",
      "invalid_token"
    );
  }
}

async function authenticateClient(
  runtime: Runtime,
  request: Request,
  body: Record<string, string>
): Promise<OAuthClientInformationFull> {
  const basic = request.headers.get("authorization");
  let clientId = body.client_id;
  let clientSecret = body.client_secret;

  if (basic?.startsWith("Basic ")) {
    const decoded = atob(basic.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    clientId = separator >= 0 ? decoded.slice(0, separator) : decoded;
    clientSecret = separator >= 0 ? decoded.slice(separator + 1) : "";
  }

  if (!clientId) {
    throw new InvalidClientError("client_id is required");
  }

  const client = await runtime.oauthProvider.clientsStore.getClient(clientId);
  if (!client) {
    throw new InvalidClientError("Invalid client_id");
  }

  const authMethod = client.token_endpoint_auth_method ?? "client_secret_basic";
  if (authMethod === "none") {
    return client;
  }

  if (!clientSecret || client.client_secret !== clientSecret) {
    throw new InvalidClientError("Client authentication failed");
  }

  return client;
}

async function parseFormBody(request: Request): Promise<Record<string, string>> {
  const formData = await request.formData();
  const body: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      body[key] = value;
    }
  }

  return body;
}

function resolveRedirectUri(
  client: OAuthClientInformationFull,
  requestedRedirectUri?: string
): string {
  if (requestedRedirectUri) {
    if (!client.redirect_uris.includes(requestedRedirectUri)) {
      throw new InvalidRequestError("Unregistered redirect_uri");
    }
    return requestedRedirectUri;
  }

  if (client.redirect_uris.length !== 1) {
    throw new InvalidRequestError(
      "redirect_uri must be provided when multiple redirect URIs are registered"
    );
  }

  return client.redirect_uris[0]!;
}

async function verifyPkceChallenge(
  codeVerifier: string,
  codeChallenge: string
): Promise<boolean> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier)
  );
  const encoded = Buffer.from(digest).toString("base64url");
  return encoded === codeChallenge;
}

function createJsonResponse(
  body: unknown,
  status: number = 200,
  headers?: HeadersInit
): Response {
  const resolvedHeaders = new Headers(headers);
  if (!resolvedHeaders.has("Content-Type")) {
    resolvedHeaders.set("Content-Type", "application/json");
  }

  return new Response(JSON.stringify(body), {
    headers: resolvedHeaders,
    status
  });
}

function createHtmlResponse(
  html: string,
  status: number = 200,
  headers?: Headers
): Response {
  const resolvedHeaders = headers ?? new Headers();
  if (!resolvedHeaders.has("Content-Type")) {
    resolvedHeaders.set("Content-Type", "text/html; charset=utf-8");
  }
  if (!resolvedHeaders.has("Cache-Control")) {
    resolvedHeaders.set("Cache-Control", "no-store");
  }
  if (!resolvedHeaders.has("Content-Security-Policy")) {
    resolvedHeaders.set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    );
  }
  if (!resolvedHeaders.has("Referrer-Policy")) {
    resolvedHeaders.set("Referrer-Policy", "no-referrer");
  }
  if (!resolvedHeaders.has("X-Frame-Options")) {
    resolvedHeaders.set("X-Frame-Options", "DENY");
  }

  return new Response(html, {
    headers: resolvedHeaders,
    status
  });
}

function redirectResponse(location: string, headers?: Headers): Response {
  const resolvedHeaders = headers ?? new Headers();
  resolvedHeaders.set("Cache-Control", "no-store");
  resolvedHeaders.set("Location", location);
  return new Response(null, {
    headers: resolvedHeaders,
    status: 302
  });
}

function createCorsPreflightResponse(): Response {
  return new Response(null, {
    headers: corsHeaders(),
    status: 204
  });
}

function corsHeaders(extra?: Record<string, string>): Headers {
  return new Headers({
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    ...(extra ?? {})
  });
}

function createOAuthErrorResponse(
  error: OAuthError,
  status?: number,
  headers?: Headers
): Response {
  const resolvedHeaders = headers ?? new Headers();
  resolvedHeaders.set("Cache-Control", "no-store");
  return createJsonResponse(
    error.toResponseObject(),
    status ?? (error instanceof ServerError ? 500 : 400),
    resolvedHeaders
  );
}

function unauthorizedResponse(
  runtime: Runtime,
  message: string,
  errorCode: "invalid_token" | "invalid_request"
): Response {
  return createJsonResponse(
    {
      error: "unauthorized",
      error_description: message
    },
    401,
    {
      "Cache-Control": "no-store",
      "WWW-Authenticate": `Bearer error="${errorCode}", error_description="${escapeAttribute(
        message
      )}", resource_metadata="${getOAuthProtectedResourceMetadataUrl(
        runtime.config.oauth.mcpServerUrl
      )}"`
    }
  );
}

function forbiddenResponse(message: string): Response {
  return createJsonResponse(
    {
      error: "insufficient_scope",
      error_description: message
    },
    403,
    {
      "Cache-Control": "no-store"
    }
  );
}

function requestKey(request: Request, namespace: string, subject?: string): string {
  const keyParts = [namespace, getClientIp(request)];
  if (subject) {
    keyParts.push(subject);
  }
  return keyParts.join(":");
}

type RateLimitConfig = {
  limit: number;
  windowMs: number;
};

type RateLimitState = {
  hitCount: number;
  limit: number;
  oldestTimestamp?: number;
  remaining: number;
  resetInMs: number;
};

type RateLimiter = {
  allow(key: string, config: RateLimitConfig): boolean;
  inspect(key: string, config: RateLimitConfig): RateLimitState;
};

function createRateLimiter(): RateLimiter {
  const hits = new Map<string, number[]>();
  const snapshot = (key: string, config: RateLimitConfig, now: number): RateLimitState => {
    const current = hits.get(key) ?? [];
    const active = current.filter((timestamp) => now - timestamp < config.windowMs);
    hits.set(key, active);

    const oldestTimestamp = active[0];
    const resetInMs = oldestTimestamp
      ? Math.max(0, config.windowMs - (now - oldestTimestamp))
      : 0;

    return {
      hitCount: active.length,
      limit: config.limit,
      oldestTimestamp,
      remaining: Math.max(0, config.limit - active.length),
      resetInMs
    };
  };

  return {
    allow(key, config) {
      const now = Date.now();
      const state = snapshot(key, config, now);
      if (state.hitCount >= config.limit) {
        return false;
      }
      const next = hits.get(key) ?? [];
      next.push(now);
      hits.set(key, next);
      return true;
    },
    inspect(key, config) {
      return snapshot(key, config, Date.now());
    }
  };
}

function withRetryAfterHeaders(
  config: RateLimitConfig,
  headers: HeadersInit = new Headers()
): Headers {
  const resolvedHeaders = new Headers(headers);
  resolvedHeaders.set("Retry-After", String(Math.ceil(config.windowMs / 1000)));
  return resolvedHeaders;
}

function isCorsPath(pathname: string, runtime: Runtime): boolean {
  if (!runtime.config.oauth.enabled) {
    return false;
  }

  return (
    pathname === "/register" ||
    pathname === "/token" ||
    pathname === "/revoke" ||
    pathname === "/.well-known/oauth-authorization-server" ||
    pathname === ROOT_PROTECTED_RESOURCE_METADATA_PATH ||
    pathname ===
      new URL(getOAuthProtectedResourceMetadataUrl(runtime.config.oauth.mcpServerUrl)).pathname
  );
}

function requiredField(value: string | undefined, name: string): string {
  if (!value) {
    throw new InvalidRequestError(`${name} is required`);
  }
  return value;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack
    };
  }

  return {
    value: String(error)
  };
}

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || "anonymous";
}

function parseRequestedScopes(
  scope: string | undefined,
  config: Runtime["config"]
): string[] {
  return scope?.split(" ").filter(Boolean) || [config.oauth.readScope];
}

function buildAuthorizeAttemptKey(
  request: Request,
  session: { email: string; userId: number } | null
): string {
  return requestKey(
    request,
    "authorize-attempt",
    normalizeRateLimitIdentity(session ? String(session.userId) : undefined)
  );
}

function normalizeRateLimitIdentity(value: string | undefined): string {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || "anonymous";
}

function createAuthorizeRateLimitResponse(
  runtime: Runtime,
  client: OAuthClientInformationFull,
  params: {
    codeChallenge: string;
    redirectUri: string;
    resource?: URL;
    scopes: string[];
    state?: string;
  },
  form: Record<string, string> | undefined,
  sessionState: {
    reason: "missing" | "expired" | "invalid" | "valid";
    session: { displayName: string; email: string; userId: number } | null;
  },
  cookieHeader: string | undefined,
  rateLimit: RateLimitConfig
): Response {
  const headers = withRetryAfterHeaders(rateLimit);
  if (sessionState.reason === "expired" || sessionState.reason === "invalid") {
    headers.append("Set-Cookie", buildExpiredSessionCookie(runtime.config.oauth));
  }
  const csrf = ensureCsrfToken(cookieHeader);
  if (csrf.cookie) {
    headers.append("Set-Cookie", buildCsrfCookie(runtime.config.oauth, csrf.cookie));
  }

  return createHtmlResponse(
    renderAuthorizeHtml(client, {
      csrfToken: csrf.token,
      edTokenHint:
        canReuseAuthorizeSession(runtime, sessionState.session?.userId)
          ? "Leave this blank to reuse your current browser session."
          : "Paste your Ed API token here.",
      errorMessage: "Too many attempts. Wait a bit and try again.",
      params,
      requestedScopes: params.scopes,
      session: sessionState.reason === "valid" ? sessionState.session ?? undefined : undefined,
      showEdToken:
        sessionState.reason !== "valid" ||
        !canReuseAuthorizeSession(runtime, sessionState.session?.userId)
    }),
    429,
    headers
  );
}

function canReuseAuthorizeSession(runtime: Runtime, userId: number | undefined): boolean {
  if (!userId) {
    return false;
  }

  const status = runtime.credentials.getConnectionStatus(userId);
  return status.connected && !status.isInvalid;
}

function mapEdConnectionError(error: unknown): string {
  if (error instanceof EdIdentityMismatchError) {
    return `${error.message} Start a fresh OAuth sign-in if you want to switch Ed identities.`;
  }
  return error instanceof Error ? error.message : String(error);
}

function appendSessionCleanupCookies(
  headers: Headers,
  config: Runtime["config"]["oauth"],
  reason: "missing" | "expired" | "invalid"
): void {
  if (reason === "missing") {
    return;
  }

  headers.append("Set-Cookie", buildExpiredSessionCookie(config));
  headers.append("Set-Cookie", buildExpiredCsrfCookie(config));
}

function renderSessionRequiredPage(
  kind: "settings" | "reconnect",
  reason: "missing" | "expired" | "invalid"
): string {
  const detail =
    reason === "expired"
      ? "Your browser session expired. Start a fresh OAuth sign-in, then come back."
      : reason === "invalid"
        ? "Your browser session is no longer valid. Start a fresh OAuth sign-in, then come back."
        : "Open this page from a browser session that already authorized EdStem MCP.";
  return renderStandalonePage({
    body: `
      <section class="card">
        <div class="card-header">
          <div class="eyebrow" translate="no">EdStem MCP</div>
          <h1>Sign In Again</h1>
          <p class="description">${escapeHtml(detail)}</p>
        </div>
        <div class="card-content">
          <div class="meta-row">
            <span class="meta-label">Return To</span>
            <span class="meta-value mono" translate="no">${escapeHtml(kind)}</span>
          </div>
        </div>
      </section>
    `,
    title: "Sign in first"
  });
}

function renderDeletedPage(): string {
  return renderStandalonePage({
    body: `
      <section class="card">
        <div class="card-header">
          <div class="eyebrow">Connection Removed</div>
          <h1>Identity Deleted</h1>
          <p class="description">Your encrypted Ed token and local session were removed from this service.</p>
        </div>
      </section>
    `,
    title: "Identity deleted"
  });
}

function renderSettingsPage(options: {
  csrfToken: string;
  errorMessage?: string;
  session: { displayName: string; email: string; userId: number };
  status: { connected: boolean; edUserName?: string; isInvalid: boolean; lastVerifiedAt?: number };
}): string {
  return renderStandalonePage({
    body: `
      <section class="card">
        <div class="card-header">
          <div class="eyebrow">Connection Settings</div>
          <h1>Ed Connection</h1>
          <p class="description">${escapeHtml(options.session.displayName)} · ${escapeHtml(options.session.email)}</p>
        </div>
        <div class="card-content">
          <div class="meta-grid">
            <div class="meta-row">
              <span class="meta-label">Status</span>
              <span class="meta-value">${escapeHtml(formatConnectionStatus(options.status))}</span>
            </div>
            <div class="meta-row">
              <span class="meta-label">Last Verified</span>
              <span class="meta-value">${escapeHtml(formatVerifiedAt(options.status.lastVerifiedAt))}</span>
            </div>
          </div>
        </div>
      </section>
      <section class="card">
        <div class="card-header">
          <h2>Rotate Ed Token</h2>
          <p class="description">Paste a fresh token for the same Ed identity. To switch identities, start a new OAuth sign-in.</p>
        </div>
        <div class="card-content">
          ${options.errorMessage ? `<div class="error-banner" aria-live="polite">${escapeHtml(options.errorMessage)}</div>` : ""}
          <form method="post" action="/settings/rotate" class="form-stack" data-busy-label="Updating…">
            <input type="hidden" name="csrf_token" value="${escapeHtml(options.csrfToken)}">
            <label for="settings-ed-token">Ed API Token</label>
            <input id="settings-ed-token" type="password" name="ed_token" autocomplete="off" spellcheck="false" placeholder="Paste your new Ed API token…">
            <button type="submit">Update Ed Token</button>
          </form>
        </div>
        <div class="card-footer">
          <form method="post" action="/settings/delete" onsubmit="return confirm('Delete this local identity?');" data-busy-label="Deleting…">
            <input type="hidden" name="csrf_token" value="${escapeHtml(options.csrfToken)}">
            <button type="submit" class="button-destructive">Delete Local Identity</button>
          </form>
        </div>
      </section>
    `,
    title: "Settings"
  });
}

function renderReconnectPage(options: {
  csrfToken: string;
  errorMessage?: string;
  session: { displayName: string; email: string; userId: number };
  status: { connected: boolean; edUserName?: string; isInvalid: boolean; lastVerifiedAt?: number };
}): string {
  return renderStandalonePage({
    body: `
      <section class="card">
        <div class="card-header">
          <div class="eyebrow">Reconnect Ed</div>
          <h1>Reconnect Ed Access</h1>
          <p class="description">${escapeHtml(options.session.displayName)} · ${escapeHtml(options.session.email)}</p>
        </div>
        <div class="card-content">
          <div class="meta-row">
            <span class="meta-label">Status</span>
            <span class="meta-value">${escapeHtml(formatConnectionStatus(options.status))}</span>
          </div>
        </div>
      </section>
      <section class="card">
        <div class="card-header">
          <h2>Paste a Fresh Token</h2>
          <p class="description">This restores MCP access for the same Ed identity.</p>
        </div>
        <div class="card-content">
          ${options.errorMessage ? `<div class="error-banner" aria-live="polite">${escapeHtml(options.errorMessage)}</div>` : ""}
          <form method="post" action="/reconnect" class="form-stack" data-busy-label="Reconnecting…">
            <input type="hidden" name="csrf_token" value="${escapeHtml(options.csrfToken)}">
            <label for="reconnect-ed-token">Ed API Token</label>
            <input id="reconnect-ed-token" type="password" name="ed_token" autocomplete="off" spellcheck="false" placeholder="Paste your Ed API token…">
            <button type="submit">Reconnect Ed Access</button>
          </form>
        </div>
      </section>
    `,
    title: "Reconnect"
  });
}

function renderStandalonePage(options: { body: string; title: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(options.title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
      :root {
        color-scheme: light;
        --background: #fafafa;
        --foreground: #0f0f10;
        --card: #ffffff;
        --muted: #6b6b73;
        --muted-background: #f4f4f5;
        --border: #e4e4e7;
        --input: #e4e4e7;
        --ring: rgba(15, 15, 16, 0.12);
        --primary: #18181b;
        --primary-hover: #09090b;
        --primary-foreground: #fafafa;
        --destructive: #b42318;
        --destructive-background: #fef3f2;
        --radius: 0.875rem;
        --shadow: 0 1px 2px rgba(15, 15, 16, 0.04), 0 12px 32px rgba(15, 15, 16, 0.06);
      }
      * {
        box-sizing: border-box;
        -webkit-tap-highlight-color: rgba(15, 15, 16, 0.08);
      }
      html {
        background: var(--background);
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--background);
        color: var(--foreground);
        font-family: "IBM Plex Sans", sans-serif;
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
      }
      main {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
      }
      .skip-link {
        position: absolute;
        top: 0.75rem;
        left: 0.75rem;
        transform: translateY(-160%);
        border-radius: calc(var(--radius) - 0.125rem);
        background: var(--foreground);
        color: var(--primary-foreground);
        padding: 0.625rem 0.875rem;
        text-decoration: none;
        transition: transform 160ms ease;
      }
      .skip-link:focus-visible {
        transform: translateY(0);
      }
      .stack {
        width: min(100%, 29rem);
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .card {
        border: 1px solid var(--border);
        border-radius: calc(var(--radius) + 0.125rem);
        background: var(--card);
        box-shadow: var(--shadow);
      }
      .card-header,
      .card-content,
      .card-footer {
        padding-inline: 1.5rem;
      }
      .card-header {
        padding-top: 1.5rem;
        padding-bottom: 1rem;
      }
      .card-content {
        padding-bottom: 1.25rem;
      }
      .card-footer {
        padding-bottom: 1.5rem;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        min-height: 1.75rem;
        border-radius: 999px;
        border: 1px solid var(--border);
        padding: 0 0.625rem;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted);
      }
      h1,
      h2 {
        margin: 0;
        font-weight: 600;
        letter-spacing: -0.035em;
        text-wrap: balance;
      }
      h1 {
        margin-top: 0.875rem;
        font-size: clamp(1.875rem, 5vw, 2.125rem);
        line-height: 1.05;
      }
      h2 {
        font-size: 1.125rem;
        line-height: 1.2;
      }
      .description,
      .muted {
        margin-top: 0.625rem;
        color: var(--muted);
        font-size: 0.95rem;
        line-height: 1.6;
      }
      .meta-grid {
        display: grid;
        gap: 0.75rem;
      }
      .meta-row,
      .error-banner {
        border-radius: var(--radius);
        border: 1px solid var(--border);
        padding: 0.875rem 0.95rem;
      }
      .meta-row {
        background: var(--muted-background);
      }
      .meta-label {
        display: block;
        color: var(--muted);
        font-size: 0.82rem;
        font-weight: 600;
      }
      .meta-value {
        display: block;
        margin-top: 0.25rem;
        font-size: 0.9rem;
        line-height: 1.5;
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }
      .mono {
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.8rem;
      }
      .form-stack {
        display: grid;
        gap: 1rem;
      }
      label {
        font-size: 0.92rem;
        font-weight: 600;
      }
      input,
      button {
        width: 100%;
        min-height: 2.875rem;
        border-radius: calc(var(--radius) - 0.125rem);
        font: inherit;
      }
      input {
        border: 1px solid var(--input);
        padding: 0.75rem 0.875rem;
        background: white;
      }
      input::placeholder {
        color: #a1a1aa;
      }
      input:focus-visible,
      button:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--ring);
      }
      button {
        border: 0;
        background: var(--primary);
        color: var(--primary-foreground);
        font-weight: 600;
        cursor: pointer;
        touch-action: manipulation;
        transition: background-color 160ms ease, transform 160ms ease;
      }
      button:hover {
        background: var(--primary-hover);
      }
      button:active {
        transform: translateY(1px);
      }
      .error-banner {
        margin-bottom: 1rem;
        color: var(--danger);
        background: var(--destructive-background);
        border-color: #fecaca;
      }
      .button-destructive {
        background: var(--destructive);
      }
      .button-destructive:hover {
        background: #991b1b;
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation: none !important;
          transition-duration: 0ms !important;
          scroll-behavior: auto !important;
        }
      }
      @media (max-width: 640px) {
        main {
          padding: 1rem;
        }
      }
    </style>
  </head>
  <body>
    <a class="skip-link" href="#main-content">Skip to Content</a>
    <main id="main-content"><div class="stack">${options.body}</div></main>
    <script>
      for (const form of document.querySelectorAll('form[data-busy-label]')) {
        if (!(form instanceof HTMLFormElement)) {
          continue;
        }
        form.addEventListener('submit', () => {
          const button = form.querySelector('button[type="submit"]');
          if (!(button instanceof HTMLButtonElement)) {
            return;
          }
          button.disabled = true;
          button.textContent = form.dataset.busyLabel || 'Working…';
        });
      }
    </script>
  </body>
</html>`;
}

function formatConnectionStatus(status: {
  connected: boolean;
  edUserName?: string;
  isInvalid: boolean;
}): string {
  if (!status.connected) {
    return "Not connected";
  }
  if (status.isInvalid) {
    return "Needs reconnect";
  }
  return status.edUserName ? `Connected as ${status.edUserName}` : "Connected";
}

function formatVerifiedAt(timestamp: number | undefined): string {
  if (!timestamp) {
    return "Not verified yet";
  }
  return new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
