import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { parse } from "yaml";

export interface EdstemConfig {
  apiBaseUrl: string;
  fetchCount: number;
}

const DEFAULT_CONFIG: EdstemConfig = {
  apiBaseUrl: "https://edstem.org/api/",
  fetchCount: 30,
};

export async function loadConfig(
  path = process.env.EDSTEM_CONFIG?.trim() || join(homedir(), ".config", "edstem-cli", "config.yaml")
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
  const apiBaseUrl = process.env.EDSTEM_BASE_URL?.trim() || DEFAULT_CONFIG.apiBaseUrl;
  return { apiBaseUrl, fetchCount };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
