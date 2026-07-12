import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "yaml";

export interface EdstemConfig {
  apiBaseUrl: string;
  fetchCount: number;
}

const DEFAULT_CONFIG: EdstemConfig = {
  apiBaseUrl: "https://edstem.org/api/",
  fetchCount: 30,
};

export async function loadConfig(path = resolve("config.yaml")): Promise<EdstemConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_CONFIG };
    }
    throw error;
  }

  const parsed = parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...DEFAULT_CONFIG };
  }
  const config = parsed as Record<string, unknown>;
  const fetchConfig = asRecord(config.fetch);
  const configuredCount = Number(fetchConfig.count);
  const fetchCount = Number.isInteger(configuredCount) && configuredCount > 0
    ? configuredCount
    : DEFAULT_CONFIG.fetchCount;
  const apiBaseUrl = process.env.ED_API_BASE_URL?.trim() || DEFAULT_CONFIG.apiBaseUrl;
  return { apiBaseUrl, fetchCount };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
