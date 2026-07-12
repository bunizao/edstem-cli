import { serve } from "bun";

import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { createRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const runtime = createRuntime(config);
  let server: ReturnType<typeof serve> | undefined;
  let isShuttingDown = false;

  try {
    const app = createApp(runtime);
    server = serve({
      fetch: app.fetch,
      port: config.port
    });

    runtime.logger.info(
      {
        hostname: server.hostname,
        mcpPath: config.mcpPath,
        port: server.port
      },
      "edstem-mcp listening"
    );

    const shutdown = (signal: string) => {
      if (isShuttingDown) {
        return;
      }
      isShuttingDown = true;
      runtime.logger.info({ signal }, "shutting down");
      server?.stop(true);
      runtime.close();
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    runtime.close();
    throw error;
  }
}

main().catch((error) => {
  console.error(formatStartupError(error));
  process.exitCode = 1;
});

function formatStartupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lines = [`Startup failed: ${message}`];

  if (message.includes("MASTER_KEY is required")) {
    lines.push("Generate one with: openssl rand -base64 32");
  }
  if (
    message.includes("must decode to exactly 32 bytes") ||
    message.includes("must be a valid base64 string")
  ) {
    lines.push("MASTER_KEY must be a base64 value that decodes to exactly 32 bytes.");
  }
  if (message.includes("EADDRINUSE")) {
    lines.push(`Port ${process.env.PORT ?? "8787"} is already in use. Set PORT or stop the conflicting process.`);
  }
  if (message.includes("SQLITE") || message.includes("database")) {
    lines.push(`Check DATABASE_PATH (${process.env.DATABASE_PATH ?? ".data/edstem-mcp.db"}) and filesystem permissions.`);
  }

  return lines.join("\n");
}
