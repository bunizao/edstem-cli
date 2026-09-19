import type { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { reportError } from "@bunizao/cli-kit";

import { loadToken } from "./auth.js";
import { loadConfig } from "./config.js";
import { EdClient } from "./ed/client.js";
import { normalizeEdError } from "./errors.js";
import { isMainModule } from "./main.js";
import { createEdMcpServer } from "./mcp/server.js";
import { VERSION } from "./version.js";

const USAGE = `edstem-mcp - local stdio MCP server for Ed Discussion.

It speaks MCP over stdin/stdout, so an MCP client launches it; there is
nothing to interact with in a terminal.

Options:
  -h, --help     Show this message.
  -V, --version  Show the version.

Authentication reads EDSTEM_TOKEN, then ~/.config/edstem-cli/token.

MCP client configuration:
  {
    "mcpServers": {
      "edstem": {
        "command": "edstem-mcp",
        "env": { "EDSTEM_TOKEN": "your-token" }
      }
    }
  }
`;

export function createStdioEdMcpServer(client: EdClient): McpServer {
  return createEdMcpServer({
    canPost: () => process.env.EDSTEM_ALLOW_POSTING === "1",
    canWrite: () => true,
    getClient: () => client,
  });
}

export async function startStdioServer(): Promise<void> {
  const [token, config] = await Promise.all([loadToken(), loadConfig()]);
  const client = new EdClient({
    apiBaseUrl: config.apiBaseUrl,
    maxRetries: config.maxRetries,
    retryBaseDelayMs: config.retryBaseDelayMs,
    token,
  });
  await createStdioEdMcpServer(client).connect(new StdioServerTransport());
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
  } else if (args.includes("--version") || args.includes("-V")) {
    process.stdout.write(`${VERSION}\n`);
  } else {
    void startStdioServer().catch((error) => {
      const reported = reportError(normalizeEdError(error), "json");
      process.stderr.write(reported.text);
      process.exitCode = reported.exitCode;
    });
  }
}
