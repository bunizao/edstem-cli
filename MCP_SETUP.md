# MCP setup guide

This guide deploys Edstem MCP to Cloudflare Workers and connects it to ChatGPT web, Codex, or Claude.

## Before you start

You need:

- A Cloudflare account.
- An Ed API token from [Ed settings](https://edstem.org/settings/api-tokens).
- The hostname Cloudflare assigns after deployment.

Never put the Ed token in a URL. The Worker accepts it through `Authorization` or `X-API-Key`, validates it against Ed, and does not store it.

## Deploy the Worker

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bunizao/edstem-cli/tree/feat/cloudflare-worker-mcp)

1. Select **Deploy to Cloudflare** and sign in.
2. Choose a repository and Worker name.
3. Deploy, then copy the assigned `workers.dev` hostname.
4. Check `https://<worker-host>/healthz`. It should return `{"ok":true,...}`.

Your MCP URL is:

```text
https://<worker-host>/mcp
```

For manual deployment:

```bash
npm ci
npx wrangler login
npm run deploy:worker
```

For production, add these Worker variables in the Cloudflare dashboard:

```text
MCP_ALLOWED_HOSTNAMES=<worker-host>
MCP_ALLOWED_ORIGIN_HOSTNAMES=chatgpt.com,claude.ai
```

## Choose the right connection

| Client | URL | Authentication |
| --- | --- | --- |
| ChatGPT web | `https://edstem.tuuhub.com/mcp` | OAuth |
| Codex desktop, CLI, or IDE | Your Worker `/mcp` URL | Ed token through an environment variable |
| Claude connector | Your Worker `/mcp` URL when Request headers are available | `Authorization` or `X-API-Key` |
| Claude connector without Request headers | `https://edstem.tuuhub.com/mcp` | OAuth |

Static Ed tokens are a convenience authentication mode, not MCP OAuth. ChatGPT web does not provide a field for an arbitrary API key, so it uses the hosted OAuth endpoint.

## ChatGPT web

1. Open ChatGPT **Settings > Security and login** and enable **Developer mode**.
2. Open [ChatGPT Plugins](https://chatgpt.com/plugins) and select the plus button.
3. Enter `https://edstem.tuuhub.com/mcp` as the MCP server URL.
4. Create the connection and complete OAuth sign-in.
5. Install the plugin, open a Work chat, and select it with `@`.

Your static-token Worker cannot connect directly to ChatGPT web. Use the OAuth endpoint above.

## Codex

Codex desktop, CLI, and the IDE extension share MCP configuration. Export the token:

```bash
export EDSTEM_TOKEN="your-ed-token"
```

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.edstem]
url = "https://<worker-host>/mcp"
bearer_token_env_var = "EDSTEM_TOKEN"
```

To use `X-API-Key` instead, replace `bearer_token_env_var` with:

```toml
env_http_headers = { "X-API-Key" = "EDSTEM_TOKEN" }
```

Restart Codex, then run `/mcp` or `codex mcp list` to check the connection.

## Claude connector

Static request headers are a beta feature with gradual availability.

For Free, Pro, or Max accounts:

1. Open Claude **Settings > Connectors**.
2. Select **Add custom connector** and enter your Worker `/mcp` URL.
3. If **Request headers** is available, add one of:
   - `Authorization` = `Bearer <your-ed-token>`
   - `X-API-Key` = `<your-ed-token>`
4. Add the connector, then enable it from **+ > Connectors** in a conversation.

For Team or Enterprise, an owner adds the connector under **Admin settings > Connectors**. Members connect it under **Settings > Connectors**.

If the Request headers field is unavailable, add `https://edstem.tuuhub.com/mcp` and use OAuth instead. Do not configure a static `Authorization` header and OAuth on the same connector.

## Official references

- [Cloudflare deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [OpenAI MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)
- [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth)
- [Anthropic custom connectors](https://claude.com/docs/connectors/custom/remote-mcp)
- [Anthropic connector authentication](https://claude.com/docs/connectors/building/authentication)
- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
