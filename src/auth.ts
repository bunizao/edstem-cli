import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { createUi, type Ui } from "@bunizao/cli-kit";
import { CliError } from "./errors.js";
import { ED_REGIONS, parseRegion, tokenPageUrl, type EdRegion } from "./regions.js";

export const TOKEN_HELP_URL = tokenPageUrl("au");

export type TokenSource = "environment" | "file";

export interface LoadedToken {
  region: EdRegion;
  source: TokenSource;
  token: string;
  tokenFile: string;
}

export interface TokenSourceOptions {
  env?: NodeJS.ProcessEnv;
  interactive?: boolean;
  prompt?: () => Promise<string>;
  promptRegion?: () => Promise<EdRegion>;
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
  const environmentRegion = env.EDSTEM_REGION?.trim() ? parseRegion(env.EDSTEM_REGION) : undefined;
  if (fromEnvironment) {
    return { source: "environment", token: fromEnvironment, tokenFile, region: environmentRegion ?? "au" };
  }

  try {
    const fromFile = (await readFile(tokenFile, "utf8")).trim();
    if (fromFile) {
      let token = fromFile;
      let region: EdRegion = "au";
      if (fromFile.startsWith("{")) {
        let saved: unknown;
        try {
          saved = JSON.parse(fromFile);
        } catch {
          throw new CliError("config", `Invalid Ed credentials in ${tokenFile}. Run edstem auth login again.`);
        }
        if (!saved || typeof saved !== "object" || !("token" in saved) ||
          typeof saved.token !== "string" || !saved.token.trim() || !("region" in saved) ||
          (saved.region !== "au" && saved.region !== "us" && saved.region !== "eu")) {
          throw new CliError("config", `Invalid Ed credentials in ${tokenFile}. Run edstem auth login again.`);
        }
        token = saved.token.trim();
        region = saved.region;
      }
      return { source: "file", token, tokenFile, region: environmentRegion ?? region };
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw new CliError("config", `Could not read Ed token file: ${tokenFile}`);
    }
  }

  const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stderr.isTTY);
  if (interactive) {
    const region = environmentRegion ?? await (options.promptRegion ?? promptEdRegion)();
    const token = (await (options.prompt ?? (() => promptHiddenToken(region)))()).trim();
    if (!token) {
      throw new CliError("auth", "No Ed token provided");
    }
    await saveToken(token, tokenFile, region);
    return { source: "file", token, tokenFile, region };
  }

  throw new CliError(
    "auth",
    `No Ed token found. Run edstem auth login, set EDSTEM_TOKEN, or create ${tokenFile}. Get a token at ${tokenPageUrl(environmentRegion ?? "au")}.`
  );
}

export async function saveToken(token: string, tokenFile = defaultTokenFile(), region: EdRegion = "au"): Promise<void> {
  await mkdir(dirname(tokenFile), { recursive: true, mode: 0o700 });
  await writeFile(tokenFile, `${JSON.stringify({ token, region })}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(tokenFile, 0o600);
}

export async function promptEdRegion(ui: Ui = createUi({ input: process.stdin, output: process.stderr })): Promise<EdRegion> {
  return ui.select("Which Ed region?", Object.entries(ED_REGIONS).map(([value, region]) => ({
    value: value as EdRegion, label: region.label, hint: region.apiBaseUrl,
  })));
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

export async function promptHiddenToken(region: EdRegion = "au"): Promise<string> {
  const ui = createUi({ input: process.stdin, output: process.stderr });
  if (!ui.interactive) throw new CliError("auth", "Interactive token input requires a terminal");
  ui.info(`Create a token at ${tokenPageUrl(region)}.`);
  const token = await ui.password("Paste your Ed token").catch((error: unknown) => {
    throw error instanceof CliError && error.code === "cancelled" ? new CliError("auth", "Token input cancelled") : error;
  });
  return token;
}
