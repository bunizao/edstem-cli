import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { CliError } from "./errors.js";

const TOKEN_HELP_URL = "https://edstem.org/settings/api-tokens";

export type TokenSource = "environment" | "file";

export interface LoadedToken {
  source: TokenSource;
  token: string;
  tokenFile: string;
}

export interface TokenSourceOptions {
  env?: NodeJS.ProcessEnv;
  interactive?: boolean;
  prompt?: () => Promise<string>;
  tokenFile?: string;
}

export function defaultTokenFile(): string {
  return join(homedir(), ".config", "edstem-cli", "token");
}

export async function loadToken(options: TokenSourceOptions = {}): Promise<string> {
  return (await loadTokenWithSource(options)).token;
}

export async function loadTokenWithSource(options: TokenSourceOptions = {}): Promise<LoadedToken> {
  const env = options.env ?? process.env;
  const tokenFile = options.tokenFile ?? defaultTokenFile();
  const fromEnvironment = env.EDSTEM_TOKEN?.trim();
  if (fromEnvironment) {
    return { source: "environment", token: fromEnvironment, tokenFile };
  }

  try {
    const fromFile = (await readFile(tokenFile, "utf8")).trim();
    if (fromFile) {
      return { source: "file", token: fromFile, tokenFile };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw new CliError("config", `Could not read Ed token file: ${tokenFile}`);
    }
  }

  const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stderr.isTTY);
  if (interactive) {
    const token = (await (options.prompt ?? promptHiddenToken)()).trim();
    if (!token) {
      throw new CliError("auth", "No Ed token provided");
    }
    await saveToken(token, tokenFile);
    return { source: "file", token, tokenFile };
  }

  throw new CliError(
    "auth",
    `No Ed token found. Run edstem auth login, set EDSTEM_TOKEN, or create ${tokenFile}. Get a token at ${TOKEN_HELP_URL}.`
  );
}

export async function saveToken(token: string, tokenFile = defaultTokenFile()): Promise<void> {
  await mkdir(dirname(tokenFile), { recursive: true, mode: 0o700 });
  await writeFile(tokenFile, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(tokenFile, 0o600);
}

/** Returns true when a token file existed and was deleted. */
export async function removeToken(tokenFile = defaultTokenFile()): Promise<boolean> {
  try {
    await rm(tokenFile);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new CliError("config", `Could not remove Ed token file: ${tokenFile}`);
  }
}

export async function promptHiddenToken(): Promise<string> {
  process.stderr.write(`Create a token at ${TOKEN_HELP_URL}.\nPaste your Ed token: `);
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new CliError("auth", "Interactive token input requires a terminal");
  }

  return new Promise((resolve, reject) => {
    let token = "";
    const finish = (error?: Error): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(token);
    };
    const onData = (chunk: Buffer): void => {
      for (const byte of chunk) {
        if (byte === 3) {
          finish(new CliError("auth", "Token input cancelled"));
          return;
        }
        if (byte === 10 || byte === 13) {
          finish();
          return;
        }
        if (byte === 8 || byte === 127) {
          token = token.slice(0, -1);
          continue;
        }
        if (byte >= 32 && byte <= 126) {
          token += String.fromCharCode(byte);
        }
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}
