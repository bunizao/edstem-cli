import { EdApiError } from "./ed/client.js";

export type ErrorCode = "auth" | "config" | "input" | "not_found" | "upstream" | "unexpected";

export class CliError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly exitCode: number
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function normalizeError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }
  if (error instanceof EdApiError) {
    if (error.kind === "auth_expired") {
      return new CliError("auth", error.message, 3);
    }
    if (error.statusCode === 404) {
      return new CliError("not_found", error.message, 4);
    }
    return new CliError("upstream", error.message, 5);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new CliError("unexpected", message, 1);
}
