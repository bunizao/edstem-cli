import { CliError } from "./errors.js";

export const ED_REGIONS = {
  au: { label: "Australia (AU)", apiBaseUrl: "https://edstem.org/api/" },
  us: { label: "United States (US)", apiBaseUrl: "https://us.edstem.org/api/" },
  eu: { label: "Europe (EU)", apiBaseUrl: "https://eu.edstem.org/api/" },
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
