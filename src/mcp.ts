import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadToken } from "./auth.js";
import { loadConfig } from "./config.js";
import { EdClient } from "./ed/client.js";
import { normalizeError } from "./errors.js";
import { createEdMcpServer } from "./mcp/server.js";
import { writeError } from "./output.js";

export async function startStdioServer(): Promise<void> {
  const [token, config] = await Promise.all([loadToken(), loadConfig()]);
  const client = new EdClient({ apiBaseUrl: config.apiBaseUrl, token });
  const server = createEdMcpServer({
    canWrite: () => true,
    getClient: () => client,
  });
  await server.connect(new StdioServerTransport());
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  void startStdioServer().catch((error) => {
    writeError(normalizeError(error));
    process.exitCode = 1;
  });
}
