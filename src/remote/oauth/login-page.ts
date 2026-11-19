import { consentPage } from "@bunizao/cli-kit/consent";
import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

const TOS_URL = "https://github.com/bunizao/edstem-cli/blob/main/TOS.md";
const TOKEN_SETTINGS_URL = "https://edstem.org/settings/api-tokens";
const WRITE_SCOPE = "mcp:tools.write";

export interface RenderAuthorizePageOptions {
  csrfToken: string;
  edTokenHint: string;
  errorMessage?: string;
  /** A data:image/ URI of Ed's own icon. */
  icon?: string;
  params: AuthorizationParams;
  requestedScopes: string[];
  session?: {
    displayName: string;
    email: string;
  };
  showEdToken: boolean;
}

export function renderAuthorizePage(
  client: OAuthClientInformationFull,
  options: RenderAuthorizePageOptions
): string {
  const { params } = options;
  const fields: Record<string, string> = {
    client_id: client.client_id,
    redirect_uri: params.redirectUri,
    response_type: "code",
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    csrf_token: options.csrfToken,
    scope_read: "1"
  };
  if (params.state) fields.state = params.state;
  if (params.scopes?.length) fields.scope = params.scopes.join(" ");
  if (params.resource) fields.resource = params.resource.href;

  const hint = options.edTokenHint
    || (options.showEdToken || !options.session
      ? `Create one in [Ed's API token settings](${TOKEN_SETTINGS_URL}). It is checked with Ed, then stored encrypted on this server.`
      : `Signed in as ${options.session.displayName} (${options.session.email}). Leave this empty to keep the token you gave before.`);

  return consentPage({
    app: "Ed",
    ...(options.icon ? { appIcon: options.icon } : {}),
    client: client.client_name || client.client_id,
    redirectUri: params.redirectUri,
    access: ["See your courses, lessons, slides and forum threads", "See your activity and your own grades"],
    action: "/authorize",
    fields,
    secret: {
      name: "ed_token",
      label: "Ed API token",
      placeholder: options.showEdToken ? "Paste your Ed API token" : "Keep the saved token",
      required: options.showEdToken,
      hint
    },
    toggles: [
      ...(options.requestedScopes.includes(WRITE_SCOPE)
        ? [{
            name: "scope_write",
            label: "Also let it submit quiz and slide answers",
            hint: "Leave this off unless you want it to answer for you."
          }]
        : []),
      { name: "accept_toc", label: `I agree to the [Terms of Service](${TOS_URL})`, required: true }
    ],
    ...(options.errorMessage ? { error: options.errorMessage } : {})
  });
}
