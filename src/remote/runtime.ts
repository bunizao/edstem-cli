import type { Database } from "bun:sqlite";

import type { AppConfig } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { migrateDatabase } from "./db/migrate.js";
import { CredentialsRepository } from "./credentials/repository.js";
import { CredentialsService } from "./credentials/service.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { SqlOAuthStore } from "./oauth/sql-store.js";
import { EdstemOAuthProvider } from "./oauth/provider.js";
import { UsersRepository } from "./users/repository.js";
import { UsersService } from "./users/service.js";
import { createLogger, type Logger } from "./logger.js";

export interface Runtime {
  close(): void;
  config: AppConfig;
  credentials: CredentialsService;
  db: Database;
  logger: Logger;
  oauthProvider: EdstemOAuthProvider;
  store: SqlOAuthStore;
  users: UsersService;
}

export function createRuntime(config: AppConfig, logger?: Logger): Runtime {
  const db = openDatabase(config.databasePath);
  migrateDatabase(db);

  const resolvedLogger = logger ?? createLogger(config.logLevel);
  const users = new UsersService(new UsersRepository(db));
  const credentials = new CredentialsService(new CredentialsRepository(db), config);
  const store = new SqlOAuthStore(db);
  seedFixedOAuthClient(store, config, resolvedLogger);
  const oauthProvider = new EdstemOAuthProvider({
    config,
    credentials,
    logger: resolvedLogger,
    store,
    users
  });
  const cleanupTimer = startCleanupTimer(store, resolvedLogger, config.dbCleanupIntervalSeconds);

  return {
    close() {
      if (cleanupTimer) {
        clearInterval(cleanupTimer);
      }
      db.close();
    },
    config,
    credentials,
    db,
    logger: resolvedLogger,
    oauthProvider,
    store,
    users
  };
}

function seedFixedOAuthClient(
  store: SqlOAuthStore,
  config: AppConfig,
  logger: Logger
): void {
  if (!config.oauth.fixedClient) {
    return;
  }

  const client: OAuthClientInformationFull = {
    client_id: config.oauth.fixedClient.clientId,
    client_name: config.oauth.fixedClient.clientName,
    client_secret: config.oauth.fixedClient.clientSecret,
    client_secret_expires_at: 0,
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: config.oauth.fixedClient.redirectUris,
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post"
  };

  store.saveClient(client);
  logger.info(
    {
      clientId: client.client_id,
      event: "oauth.client_seeded",
      redirectUris: client.redirect_uris,
      tokenEndpointAuthMethod: client.token_endpoint_auth_method
    },
    "oauth client seeded"
  );
}

function startCleanupTimer(
  store: SqlOAuthStore,
  logger: Logger,
  intervalSeconds: number
): ReturnType<typeof setInterval> | undefined {
  if (intervalSeconds <= 0) {
    return undefined;
  }

  const runCleanup = () => {
    const summary = store.pruneExpired();
    if (summary.totalDeleted > 0) {
      logger.info(
        {
          event: "db.cleanup.completed",
          ...summary
        },
        "database cleanup completed"
      );
    }
  };

  runCleanup();
  const timer = setInterval(runCleanup, intervalSeconds * 1000);
  timer.unref?.();
  return timer;
}
