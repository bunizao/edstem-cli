import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  if (!command) {
    throw new Error("Usage: bun run admin -- prune-expired");
  }

  const config = loadConfig();
  const runtime = createRuntime(config);

  try {
    if (command !== "prune-expired") {
      throw new Error("Usage: bun run admin -- prune-expired");
    }

    console.log(JSON.stringify(runtime.store.pruneExpired()));
  } finally {
    runtime.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
