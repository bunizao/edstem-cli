import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  OAuthClientProvider,
  OAuthDiscoveryState
} from "@modelcontextprotocol/sdk/client/auth.js";

export class InMemoryOAuthClientProvider implements OAuthClientProvider {
  clientMetadataUrl?: string;
  private readonly redirectTarget: string;
  private readonly metadata: OAuthClientMetadata;
  private currentAuthorizationUrl?: URL;
  private currentClientInformation?: OAuthClientInformationMixed;
  private currentCodeVerifier?: string;
  private currentDiscoveryState?: OAuthDiscoveryState;
  private currentTokens?: OAuthTokens;

  constructor(options: {
    clientMetadata: OAuthClientMetadata;
    clientMetadataUrl?: string;
    redirectUrl: string;
  }) {
    this.clientMetadataUrl = options.clientMetadataUrl;
    this.metadata = options.clientMetadata;
    this.redirectTarget = options.redirectUrl;
  }

  get redirectUrl(): string {
    return this.redirectTarget;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.metadata;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.currentClientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.currentClientInformation = clientInformation;
  }

  tokens(): OAuthTokens | undefined {
    return this.currentTokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.currentTokens = tokens;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.currentAuthorizationUrl = authorizationUrl;
  }

  authorizationUrl(): URL {
    if (!this.currentAuthorizationUrl) {
      throw new Error("Authorization URL has not been created.");
    }

    return this.currentAuthorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.currentCodeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.currentCodeVerifier) {
      throw new Error("Code verifier has not been created.");
    }

    return this.currentCodeVerifier;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.currentDiscoveryState = state;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.currentDiscoveryState;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (scope === "all" || scope === "client") {
      this.currentClientInformation = undefined;
    }
    if (scope === "all" || scope === "tokens") {
      this.currentTokens = undefined;
    }
    if (scope === "all" || scope === "verifier") {
      this.currentCodeVerifier = undefined;
    }
    if (scope === "all" || scope === "discovery") {
      this.currentDiscoveryState = undefined;
    }
  }
}
