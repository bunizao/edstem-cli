import { CliError } from "./errors.js";

export const ED_REGIONS = {
  au: { label: "Australia (AU)", apiBaseUrl: "https://edstem.org/api/", tokenUrl: "https://edstem.org/settings/api-tokens" },
  us: { label: "United States (US)", apiBaseUrl: "https://us.edstem.org/api/", tokenUrl: "https://us.edstem.org/settings/api-tokens" },
  eu: { label: "Europe (EU)", apiBaseUrl: "https://eu.edstem.org/api/", tokenUrl: "https://eu.edstem.org/settings/api-tokens" },
} as const;

export type EdRegion = keyof typeof ED_REGIONS;

export function isEdRegion(value: unknown): value is EdRegion {
  return typeof value === "string" && Object.hasOwn(ED_REGIONS, value);
}

export function parseRegion(value: string): EdRegion {
  const region = value.trim().toLowerCase();
  if (isEdRegion(region)) return region;
  throw new CliError("usage", "Ed region must be au, us, or eu.");
}
