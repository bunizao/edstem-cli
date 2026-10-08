import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { parse } from "yaml";
import { ED_REGIONS, type EdRegion } from "./regions.js";

export interface EdstemConfig {
  apiBaseUrl: string;
  fetchCount: number;
  maxRetries: number;
  retryBaseDelayMs: number;
}

const DEFAULT_CONFIG: EdstemConfig = {
  apiBaseUrl: ED_REGIONS.au.apiBaseUrl,
  fetchCount: 30,
  maxRetries: 3,
  retryBaseDelayMs: 1_000,
};

export async function loadConfig(
  path = process.env.EDSTEM_CONFIG?.trim() || join(homedir(), ".config", "edstem-cli", "config.yaml"),
  region: EdRegion = "au"
): Promise<EdstemConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    raw = "";
  }

  const parsed = parse(raw) as unknown;
  const config = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const fetchConfig = asRecord(config.fetch);
  const configuredCount = Number(fetchConfig.count);
  const fetchCount = Number.isInteger(configuredCount) && configuredCount > 0
    ? configuredCount
    : DEFAULT_CONFIG.fetchCount;
  const rateLimit = asRecord(config.rateLimit);
  const configuredRetries = Number(rateLimit.maxRetries);
  const maxRetries = Number.isInteger(configuredRetries) && configuredRetries >= 0
    ? configuredRetries
    : DEFAULT_CONFIG.maxRetries;
  const configuredBaseDelay = Number(rateLimit.retryBaseDelay);
  const retryBaseDelayMs = Number.isFinite(configuredBaseDelay) && configuredBaseDelay > 0
    ? Math.round(configuredBaseDelay * 1000)
    : DEFAULT_CONFIG.retryBaseDelayMs;
  const apiBaseUrl = process.env.EDSTEM_BASE_URL?.trim() || ED_REGIONS[region].apiBaseUrl;
  return { apiBaseUrl, fetchCount, maxRetries, retryBaseDelayMs };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
