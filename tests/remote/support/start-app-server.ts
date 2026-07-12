import type { Runtime } from "../../../src/remote/runtime.js";
import { createApp } from "../../../src/remote/app.js";
import { EdstemOAuthProvider } from "../../../src/remote/oauth/provider.js";

export async function startAppServer(runtime: Runtime): Promise<{
  baseUrl: string;
  close: () => void;
}>;
export async function startAppServer(
  runtime: Runtime,
  options: { syncPublicBaseUrl: true }
): Promise<{
  baseUrl: string;
  close: () => void;
}>;
export async function startAppServer(
  runtime: Runtime,
  options?: { syncPublicBaseUrl: true }
): Promise<{
  baseUrl: string;
  close: () => void;
}> {
  const reservedPort = options?.syncPublicBaseUrl ? await reservePort() : 0;
  if (options?.syncPublicBaseUrl) {
    const baseUrl = `http://127.0.0.1:${reservedPort}`;
    runtime.config.port = reservedPort;
    runtime.config.publicBaseUrl = new URL(baseUrl);
    runtime.config.oauth.issuerUrl = new URL(baseUrl);
    runtime.config.oauth.mcpServerUrl = new URL(runtime.config.mcpPath, baseUrl);
    runtime.oauthProvider = new EdstemOAuthProvider({
      config: runtime.config,
      credentials: runtime.credentials,
      logger: runtime.logger,
      store: runtime.store,
      users: runtime.users
    });
  }

  const app = createApp(runtime);
  const server = Bun.serve({
    fetch: app.fetch,
    port: reservedPort
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    close: () => {
      server.stop(true);
    }
  };
}

async function reservePort(): Promise<number> {
  const probe = Bun.serve({
    fetch() {
      return new Response("ok");
    },
    port: 0
  });
  const port = probe.port;
  probe.stop(true);

  if (!port) {
    throw new Error("Unable to reserve a test port.");
  }

  return port;
}
