import { CliError, normalizeError } from "@bunizao/cli-kit";

import { EdApiError } from "./ed/client.js";

export { CliError } from "@bunizao/cli-kit";

export function normalizeEdError(error: unknown): CliError {
  if (error instanceof EdApiError) {
    if (error.kind === "auth_expired") return new CliError("auth", error.message);
    if (error.statusCode === 404) return new CliError("not_found", error.message);
    if (error.kind === "network") return new CliError("network", error.message);
    return new CliError("upstream", error.message);
  }
  return normalizeError(error);
}
