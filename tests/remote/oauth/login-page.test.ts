import { describe, expect, it } from "bun:test";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

import { renderAuthorizePage } from "../../../src/remote/oauth/login-page.js";

const CLIENT = { client_id: "c", client_name: "Claude", redirect_uris: ["https://claude.ai/cb"] } as OAuthClientInformationFull;
const OPTIONS = {
  csrfToken: "t",
  edTokenHint: "",
  params: { codeChallenge: "x", redirectUri: "https://claude.ai/cb", state: "s" },
  requestedScopes: ["mcp:tools.read", "mcp:tools.write"],
  showEdToken: true
};

describe("authorize page", () => {
  it("shows Ed's icon when given a data: image, else the letter E", () => {
    expect(renderAuthorizePage(CLIENT, { ...OPTIONS, icon: "data:image/png;base64,AAAA" })).toContain(
      '<div class="tile"><img alt="" src="data:image/png;base64,AAAA"></div>'
    );
    expect(renderAuthorizePage(CLIENT, OPTIONS)).toContain('<div class="tile app"><b>E</b></div>');
  });

  it("posts the OAuth fields back and asks for the token, write access and the terms", () => {
    const html = renderAuthorizePage(CLIENT, OPTIONS);
    for (const [name, value] of [["client_id", "c"], ["state", "s"], ["csrf_token", "t"], ["scope_read", "1"]]) {
      expect(html).toContain(`<input type="hidden" name="${name}" value="${value}">`);
    }
    expect(html).toMatch(/name="ed_token" id="f-ed_token" placeholder="Paste your Ed API token" required/u);
    expect(html).toContain('<input type="checkbox" name="scope_write" value="1">');
    expect(html).toContain('<input type="checkbox" name="accept_toc" value="1" required>');
    expect(renderAuthorizePage(CLIENT, { ...OPTIONS, requestedScopes: ["mcp:tools.read"] })).not.toContain("scope_write");
  });

  it("lets a signed-in user keep the saved token", () => {
    const html = renderAuthorizePage(CLIENT, { ...OPTIONS, showEdToken: false, session: { displayName: "Ada", email: "ada@example.com" } });
    expect(html).not.toMatch(/name="ed_token"[^>]*required/u);
    expect(html).toContain("Signed in as Ada (ada@example.com)");
  });
});
