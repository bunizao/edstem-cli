import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { createUi, type Ui } from "@bunizao/cli-kit";
import { CliError } from "./errors.js";
import type { EdClient } from "./ed/client.js";
import type { UserWithCourses } from "./ed/models.js";
import { ED_REGIONS, isEdRegion, parseRegion, type EdRegion } from "./regions.js";

export const TOKEN_HELP_URL = "https://edstem.org/settings/api-tokens";

export type TokenSource = "environment" | "file";
export type RegionSource = TokenSource | "default";

export interface LoadedToken {
  region: EdRegion;
  regionSource: RegionSource;
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
    const region = environmentRegion ?? "au";
    const regionSource = environmentRegion ? "environment" : "default";
    return { source: "environment", token: fromEnvironment, tokenFile, region, regionSource };
  }

  try {
    const fromFile = (await readFile(tokenFile, "utf8")).trim();
    if (fromFile) {
      let token = fromFile;
      let region: EdRegion = "au";
      let regionSource: RegionSource = "default";
      if (fromFile.startsWith("{")) {
        let saved: unknown;
        try {
          saved = JSON.parse(fromFile);
        } catch {
          throw new CliError("config", `Invalid Ed credentials in ${tokenFile}. Run edstem auth login again.`);
        }
        if (!saved || typeof saved !== "object" || !("token" in saved) ||
          typeof saved.token !== "string" || !saved.token.trim() || !("region" in saved) ||
          !isEdRegion(saved.region)) {
          throw new CliError("config", `Invalid Ed credentials in ${tokenFile}. Run edstem auth login again.`);
        }
        token = saved.token.trim();
        region = saved.region;
        regionSource = "file";
      }
      if (environmentRegion) {
        region = environmentRegion;
        regionSource = "environment";
      }
      return { source: "file", token, tokenFile, region, regionSource };
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
    const token = (await (options.prompt ?? promptHiddenToken)()).trim();
    if (!token) {
      throw new CliError("auth", "No Ed token provided");
    }
    await saveToken(token, tokenFile, region);
    return { source: "file", token, tokenFile, region, regionSource: environmentRegion ? "environment" : "file" };
  }

  throw new CliError(
    "auth",
    `No Ed token found. Run edstem auth login, set EDSTEM_TOKEN, or create ${tokenFile}. Get a token at ${TOKEN_HELP_URL}.`
  );
}

export async function saveToken(token: string, tokenFile = defaultTokenFile(), region: EdRegion = "au"): Promise<void> {
  await mkdir(dirname(tokenFile), { recursive: true, mode: 0o700 });
  await writeFile(tokenFile, `${JSON.stringify({ token, region })}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(tokenFile, 0o600);
}

/**
 * A token is valid in exactly one Ed region, so ask all of them and keep the one that answers.
 * Zero or several answers are "undetected": the caller falls back to asking the person.
 */
export async function detectRegion(
  token: string,
  createClient: (token: string, region: EdRegion) => Promise<Pick<EdClient, "fetchUser">>
): Promise<{ region: EdRegion; user: UserWithCourses } | "undetected"> {
  const regions = Object.keys(ED_REGIONS) as EdRegion[];
  const results = await Promise.allSettled(regions.map(async (region) => (await createClient(token, region)).fetchUser()));
  const accepted = regions.flatMap((region, index) => {
    const result = results[index]!;
    return result.status === "fulfilled" ? [{ region, user: result.value }] : [];
  });
  return accepted.length === 1 ? accepted[0]! : "undetected";
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

export async function promptHiddenToken(): Promise<string> {
  const ui = createUi({ input: process.stdin, output: process.stderr });
  if (!ui.interactive) throw new CliError("auth", "Interactive token input requires a terminal");
  ui.info(`Create a token at ${TOKEN_HELP_URL}.`);
  const token = await ui.password("Paste your Ed token").catch((error: unknown) => {
    throw error instanceof CliError && error.code === "cancelled" ? new CliError("auth", "Token input cancelled") : error;
  });
  return token;
}
