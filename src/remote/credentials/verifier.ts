import { EdApiError, EdAuthExpiredError, EdClient } from "../../ed/client.js";

const INVALID_TOKEN_MESSAGE =
  "Invalid or expired Ed API token. Regenerate it at https://edstem.org/settings/api-tokens.";

export interface VerifiedEdIdentity {
  edUserEmail: string;
  edUserId: number;
  edUserName: string;
}

export class EdTokenInvalidError extends Error {
  constructor(message = INVALID_TOKEN_MESSAGE) {
    super(message);
    this.name = "EdTokenInvalidError";
  }
}

export class EdApiBaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdApiBaseUrlError";
  }
}

export class EdApiUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdApiUpstreamError";
  }
}

export async function verifyEdToken(
  token: string,
  apiBaseUrl: string
): Promise<VerifiedEdIdentity> {
  try {
    const { user } = await new EdClient({ apiBaseUrl, token }).fetchUser();
    return {
      edUserEmail: user.email,
      edUserId: user.id,
      edUserName: user.name,
    };
  } catch (error) {
    if (error instanceof EdAuthExpiredError) {
      throw new EdTokenInvalidError();
    }
    if (error instanceof EdApiError && error.kind === "base_url") {
      throw new EdApiBaseUrlError(error.message);
    }
    if (error instanceof EdApiError) {
      throw new EdApiUpstreamError(error.message);
    }
    throw error;
  }
}
