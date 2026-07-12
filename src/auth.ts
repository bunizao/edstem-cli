import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { CliError } from "./errors.js";

const TOKEN_HELP_URL = "https://edstem.org/settings/api-tokens";

export interface TokenSourceOptions {
  env?: NodeJS.ProcessEnv;
  tokenFile?: string;
}

export async function loadToken(options: TokenSourceOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const fromEnvironment = env.ED_API_TOKEN?.trim();
  if (fromEnvironment) {
    return fromEnvironment;
  }

  const tokenFile = options.tokenFile ?? join(homedir(), ".config", "edstem-cli", "token");
  try {
    const fromFile = (await readFile(tokenFile, "utf8")).trim();
    if (fromFile) {
      return fromFile;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw new CliError("config", `Could not read Ed token file: ${tokenFile}`, 2);
    }
  }

  throw new CliError(
    "auth",
    `No Ed token found. Set ED_API_TOKEN or create ${tokenFile}. Get a token at ${TOKEN_HELP_URL}.`,
    3
  );
}
