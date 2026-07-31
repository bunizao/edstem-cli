import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { reportError } from "@bunizao/cli-kit";

import { loadToken } from "./auth.js";
import { loadConfig } from "./config.js";
import { EdClient } from "./ed/client.js";
import { normalizeEdError } from "./errors.js";
import { isMainModule } from "./main.js";
import { createEdMcpServer } from "./mcp/server.js";

export async function startStdioServer(): Promise<void> {
  const [token, config] = await Promise.all([loadToken(), loadConfig()]);
  const client = new EdClient({ apiBaseUrl: config.apiBaseUrl, token });
  const server = createEdMcpServer({
    canWrite: () => true,
    getClient: () => client,
  });
  await server.connect(new StdioServerTransport());
}

if (isMainModule(import.meta.url)) {
  void startStdioServer().catch((error) => {
    const reported = reportError(normalizeEdError(error), "json");
    process.stderr.write(reported.text);
    process.exitCode = reported.exitCode;
  });
}
