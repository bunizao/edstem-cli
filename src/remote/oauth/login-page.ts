import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

const REPOSITORY_URL = "https://github.com/bunizao/edstem-mcp";
const TOS_URL = `${REPOSITORY_URL}/blob/master/TOS.md`;
const TOS_LABEL = "Terms of Service";

export interface RenderAuthorizePageOptions {
  csrfToken: string;
  edTokenHint: string;
  errorMessage?: string;
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
  const clientName = client.client_name || client.client_id;
  const actionLabel = options.showEdToken ? "Authorize Ed Access" : "Authorize Access";
  const tokenPlaceholder = options.showEdToken
    ? "Paste your Ed API token…"
    : "Leave blank to reuse this session…";
  const edSettingsLabel = "Open Ed Settings";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authorize ${escapeHtml(clientName)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
      :root {
        color-scheme: light;
        --background: #fafafa;
        --foreground: #0f0f10;
        --card: #ffffff;
        --muted: #6b6b73;
        --muted-background: #f4f4f5;
        --border: #e4e4e7;
        --input: #e4e4e7;
        --ring: rgba(15, 15, 16, 0.12);
        --primary: #18181b;
        --primary-hover: #09090b;
        --primary-foreground: #fafafa;
        --destructive: #b42318;
        --destructive-background: #fef3f2;
        --radius: 0.875rem;
        --shadow: 0 1px 2px rgba(15, 15, 16, 0.04), 0 12px 32px rgba(15, 15, 16, 0.06);
      }
      * {
        box-sizing: border-box;
        -webkit-tap-highlight-color: rgba(15, 15, 16, 0.08);
      }
      html {
        background: var(--background);
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--background);
        color: var(--foreground);
        font-family: "IBM Plex Sans", sans-serif;
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
      }
      main {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
      }
      .skip-link {
        position: absolute;
        top: 0.75rem;
        left: 0.75rem;
        transform: translateY(-160%);
        border-radius: calc(var(--radius) - 0.125rem);
        background: var(--foreground);
        color: var(--primary-foreground);
        padding: 0.625rem 0.875rem;
        text-decoration: none;
        transition: transform 160ms ease;
      }
      .skip-link:focus-visible {
        transform: translateY(0);
      }
      .card {
        width: min(100%, 29rem);
        border: 1px solid var(--border);
        border-radius: calc(var(--radius) + 0.125rem);
        background: var(--card);
        box-shadow: var(--shadow);
      }
      .card-header,
      .card-content,
      .card-footer {
        padding-inline: 1.5rem;
      }
      .card-header {
        padding-top: 1.5rem;
        padding-bottom: 1rem;
      }
      .card-content {
        padding-bottom: 1.25rem;
      }
      .card-footer {
        padding-top: 0;
        padding-bottom: 1.5rem;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        min-height: 1.75rem;
        border-radius: 999px;
        border: 1px solid var(--border);
        padding: 0 0.625rem;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.72rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted);
      }
      h1 {
        margin: 0.875rem 0 0;
        font-size: clamp(1.875rem, 5vw, 2.125rem);
        font-weight: 600;
        letter-spacing: -0.035em;
        line-height: 1.05;
        text-wrap: balance;
      }
      p {
        margin: 0;
      }
      .description {
        margin-top: 0.625rem;
        color: var(--muted);
        font-size: 0.96rem;
        line-height: 1.6;
      }
      .session-chip,
      .scope-panel,
      .error-banner {
        border-radius: var(--radius);
        border: 1px solid var(--border);
      }
      .session-chip,
      .scope-panel {
        margin-top: 1rem;
      }
      .session-chip {
        background: var(--muted-background);
        padding: 0.875rem 0.95rem;
      }
      .session-chip strong {
        display: block;
        font-size: 0.82rem;
        font-weight: 600;
        color: var(--foreground);
      }
      .session-chip span {
        display: block;
        margin-top: 0.25rem;
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.5;
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }
      .error-banner {
        margin-top: 1rem;
        padding: 0.9rem 0.95rem;
        background: var(--destructive-background);
        border-color: #fecaca;
        color: var(--destructive);
        font-size: 0.92rem;
        line-height: 1.55;
      }
      .form {
        display: grid;
        gap: 1rem;
      }
      .field {
        display: grid;
        gap: 0.5rem;
      }
      label {
        font-size: 0.92rem;
        font-weight: 600;
      }
      input[type="password"] {
        width: 100%;
        min-height: 2.875rem;
        border: 1px solid var(--input);
        border-radius: calc(var(--radius) - 0.125rem);
        padding: 0.75rem 0.875rem;
        background: #fff;
        color: var(--foreground);
        font: inherit;
      }
      input[type="password"]::placeholder {
        color: #a1a1aa;
      }
      input[type="password"]:focus-visible,
      button:focus-visible,
      a:focus-visible,
      input[type="checkbox"]:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px var(--ring);
      }
      .hint,
      .link {
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.55;
      }
      .link {
        width: fit-content;
        text-decoration: none;
        touch-action: manipulation;
      }
      .link-strong {
        display: inline-flex;
        align-items: center;
        min-height: 2.5rem;
        border: 1px solid var(--border);
        border-radius: calc(var(--radius) - 0.125rem);
        padding: 0 0.875rem;
        color: var(--foreground);
        font-size: 0.9rem;
        font-weight: 600;
        line-height: 1;
      }
      .link:hover {
        color: var(--foreground);
      }
      .separator {
        height: 1px;
        background: var(--border);
      }
      .scope-panel {
        padding: 0.875rem 0.95rem;
        background: #fff;
      }
      .scope-list {
        display: grid;
        gap: 0.875rem;
      }
      .scope-row {
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
      }
      .scope-row input[type="checkbox"] {
        margin: 0.125rem 0 0;
        accent-color: var(--foreground);
      }
      .scope-copy {
        min-width: 0;
      }
      .scope-copy strong {
        display: block;
        font-size: 0.92rem;
        font-weight: 600;
        line-height: 1.4;
      }
      .scope-copy span {
        display: block;
        margin-top: 0.25rem;
        color: var(--muted);
        font-size: 0.88rem;
        line-height: 1.5;
      }
      .consent-row {
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
      }
      .consent-row input[type="checkbox"] {
        margin: 0.125rem 0 0;
        accent-color: var(--foreground);
      }
      .consent-copy {
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.55;
      }
      .consent-copy a {
        color: var(--foreground);
        font-weight: 600;
        text-decoration: none;
      }
      .consent-copy a:hover {
        text-decoration: underline;
      }
      .button {
        width: 100%;
        min-height: 2.875rem;
        border: 0;
        border-radius: calc(var(--radius) - 0.125rem);
        background: var(--primary);
        color: var(--primary-foreground);
        font: inherit;
        font-size: 0.94rem;
        font-weight: 600;
        cursor: pointer;
        touch-action: manipulation;
        transition: background-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
      }
      .button:hover {
        background: var(--primary-hover);
      }
      .button:active {
        transform: translateY(1px);
      }
      .meta-inline {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem 1rem;
        color: var(--muted);
        font-size: 0.85rem;
        line-height: 1.55;
      }
      .meta-inline strong {
        color: var(--foreground);
        font-weight: 600;
      }
      .footnote {
        margin-top: 0.75rem;
        color: var(--muted);
        font-size: 0.85rem;
        line-height: 1.55;
      }
      .nowrap {
        white-space: nowrap;
      }
      .mono {
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.8rem;
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation: none !important;
          transition-duration: 0ms !important;
          scroll-behavior: auto !important;
        }
      }
    </style>
  </head>
  <body>
    <a class="skip-link" href="#main-content">Skip to Content</a>
    <main id="main-content">
      <section class="card" aria-labelledby="auth-title">
        <div class="card-header">
          <div class="eyebrow" translate="no">EdStem MCP</div>
          <h1 id="auth-title">Connect Your Ed Account</h1>
          <p class="description">Paste your Ed API token to continue.</p>
          ${options.session ? `
            <div class="session-chip">
              <strong>Current Browser Session</strong>
              <span>${escapeHtml(options.session.displayName)} · ${escapeHtml(options.session.email)}</span>
            </div>
          ` : ""}
          ${options.errorMessage ? `<div class="error-banner" aria-live="polite">${escapeHtml(options.errorMessage)}</div>` : ""}
        </div>

        <div class="card-content">
          <form method="post" action="/authorize" class="form" data-busy-label="Authorizing…">
            <input type="hidden" name="client_id" value="${escapeHtml(client.client_id)}">
            <input type="hidden" name="redirect_uri" value="${escapeHtml(options.params.redirectUri)}">
            <input type="hidden" name="response_type" value="code">
            <input type="hidden" name="code_challenge" value="${escapeHtml(options.params.codeChallenge)}">
            <input type="hidden" name="code_challenge_method" value="S256">
            ${options.params.state ? `<input type="hidden" name="state" value="${escapeHtml(options.params.state)}">` : ""}
            ${options.params.scopes?.length ? `<input type="hidden" name="scope" value="${escapeHtml(options.params.scopes.join(" "))}">` : ""}
            ${options.params.resource ? `<input type="hidden" name="resource" value="${escapeHtml(options.params.resource.href)}">` : ""}
            <input type="hidden" name="csrf_token" value="${escapeHtml(options.csrfToken)}">
            <input type="hidden" name="scope_read" value="1">

            <div class="field">
              <label for="ed_token">Ed API Token</label>
              <input
                id="ed_token"
                name="ed_token"
                type="password"
                autocomplete="off"
                spellcheck="false"
                placeholder="${escapeHtml(tokenPlaceholder)}"
                ${options.showEdToken ? "required" : ""}
              >
              ${options.edTokenHint ? `<p class="hint">${escapeHtml(options.edTokenHint)}</p>` : ""}
            </div>

            <a class="link link-strong" href="https://edstem.org/settings/api-tokens" target="_blank" rel="noreferrer">${escapeHtml(edSettingsLabel)}</a>

            <div class="separator" aria-hidden="true"></div>

            <div class="scope-panel">
              <div class="scope-list">
                <div class="scope-row">
                  <input type="checkbox" checked disabled aria-label="Read access is required">
                  <div class="scope-copy">
                    <strong>Read courses, lessons, threads, and activity</strong>
                    <span>Required for every MCP request.</span>
                  </div>
                </div>
                ${options.requestedScopes.includes("mcp:tools.write") ? `
                  <label class="scope-row" for="scope_write">
                    <input id="scope_write" name="scope_write" type="checkbox" value="1">
                    <span class="scope-copy">
                      <strong>Allow write tools</strong>
                      <span>Enable this only if you want quiz submission and slide submission tools.</span>
                    </span>
                  </label>
                ` : ""}
              </div>
            </div>

            <label class="consent-row" for="accept_toc">
              <input id="accept_toc" name="accept_toc" type="checkbox" value="1" required>
              <span class="consent-copy">I agree to the <a href="${TOS_URL}" target="_blank" rel="noreferrer">${TOS_LABEL}</a>.</span>
            </label>

            <button class="button" type="submit">${escapeHtml(actionLabel)}</button>
          </form>
        </div>

        <div class="card-footer">
          <div class="meta-inline">
            <span><strong>Client</strong> ${escapeHtml(clientName)}</span>
            <span><strong>Scopes</strong> <span class="mono" translate="no">${escapeHtml(options.requestedScopes.join(" "))}</span></span>
            <span><a class="link" href="${REPOSITORY_URL}" target="_blank" rel="noreferrer">GitHub</a></span>
            <span><a class="link" href="${TOS_URL}" target="_blank" rel="noreferrer">${TOS_LABEL}</a></span>
          </div>
        </div>
      </section>
    </main>
    <script>
      const form = document.querySelector('form[data-busy-label]');
      if (form instanceof HTMLFormElement) {
        form.addEventListener('submit', () => {
          const button = form.querySelector('button[type="submit"]');
          if (!(button instanceof HTMLButtonElement)) {
            return;
          }
          button.disabled = true;
          button.textContent = form.dataset.busyLabel || 'Authorizing…';
        });
      }
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
