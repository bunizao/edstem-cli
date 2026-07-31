import { EdClient } from "../ed/client.js";
import { createEdMcpServer, type EdMcpRuntime, type McpToolContext } from "../mcp/server.js";
import {
  EdNotConnectedError,
  EdReconnectRequiredError,
} from "./credentials/service.js";
import type { Runtime } from "./runtime.js";

export function createRemoteMcpServer(runtime: Runtime) {
  const adapter: EdMcpRuntime = {
    authErrorExtra: () => ({
      reconnect_url: new URL("/reconnect", runtime.config.publicBaseUrl).toString(),
    }),
    canWrite: (context) => {
      const authInfo = context.http?.authInfo;
      if (!authInfo) {
        return Boolean(runtime.config.devEdApiToken);
      }
      return authInfo.scopes.includes(runtime.config.oauth.writeScope);
    },
    getClient: (context) => {
      const userId = getUserId(context);
      if (userId !== undefined) {
        return new EdClient({
          apiBaseUrl: runtime.config.apiBaseUrl,
          token: runtime.credentials.getDecryptedEdToken(userId),
        });
      }
      if (runtime.config.devEdApiToken) {
        return new EdClient({
          apiBaseUrl: runtime.config.apiBaseUrl,
          token: runtime.config.devEdApiToken,
        });
      }
      throw new EdNotConnectedError();
    },
    mapError: (error) => {
      if (error instanceof EdNotConnectedError) {
        return { message: error.message, type: "EDSTEM_NOT_CONNECTED" };
      }
      if (error instanceof EdReconnectRequiredError) {
        return {
          extra: { reconnect_url: new URL("/reconnect", runtime.config.publicBaseUrl).toString() },
          message: error.message,
          type: "EDSTEM_REAUTH_REQUIRED",
        };
      }
      return undefined;
    },
    onAuthExpired: (context) => {
      const userId = getUserId(context);
      if (userId !== undefined) {
        runtime.credentials.markInvalid(userId);
      }
    },
  };
  return createEdMcpServer(adapter);
}

function getUserId(context: McpToolContext): number | undefined {
  const userId = context.http?.authInfo?.extra?.userId;
  return typeof userId === "number" ? userId : undefined;
}
