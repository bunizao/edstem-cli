import { describe, expect, it } from "bun:test";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

import { renderAuthorizePage } from "../../../src/remote/oauth/login-page.js";

const CLIENT = { client_id: "c", client_name: "Claude", redirect_uris: ["https://claude.ai/cb"] } as OAuthClientInformationFull;
const OPTIONS = {
  csrfToken: "t",
  edTokenHint: "",
  params: { codeChallenge: "x", redirectUri: "https://claude.ai/cb" },
  requestedScopes: [],
  showEdToken: true
};

describe("authorize page", () => {
  it("shows Ed's icon when given a data: image and nothing otherwise", () => {
    expect(renderAuthorizePage(CLIENT, { ...OPTIONS, icon: "data:image/png;base64,AAAA" })).toContain(
      '<img class="site-icon" alt="" src="data:image/png;base64,AAAA">'
    );
    expect(renderAuthorizePage(CLIENT, { ...OPTIONS, icon: "https://evil.example/x.png" })).not.toContain("<img");
    expect(renderAuthorizePage(CLIENT, OPTIONS)).not.toContain("<img");
  });
});
