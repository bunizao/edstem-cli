# edstem-cli

CLI and MCP access to Ed Discussion for people, scripts, and agents.

[![npm version](https://img.shields.io/npm/v/edstem-cli?logo=npm)](https://www.npmjs.com/package/edstem-cli)
[![npm downloads](https://img.shields.io/npm/dm/edstem-cli?logo=npm)](https://www.npmjs.com/package/edstem-cli)
[![CI](https://github.com/bunizao/edstem-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/bunizao/edstem-cli/actions/workflows/ci.yml)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-local%20%2B%20hosted-5A67D8)](https://modelcontextprotocol.io/)
[![Quiz answering](https://img.shields.io/badge/quiz%20answering-beta-orange)](#quiz-answering-beta)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

One Ed implementation powers three entry points:

| Surface | Runtime | Best for | Authentication |
| --- | --- | --- | --- |
| `edstem` | Node.js 20+ | People, scripts, and agents | Local Ed API token |
| `edstem-mcp` | Node.js 20+ | Local stdio MCP clients | Local Ed API token |
| Hosted MCP | Bun | Remote MCP clients and shared deployments | OAuth at [`edstem.tuuhub.com/mcp`](https://edstem.tuuhub.com/mcp) |

## Installation

```bash
npm install -g edstem-cli
export ED_API_TOKEN="your-token"
edstem user --fields id,name,courses
```

Create a token at [edstem.org/settings/api-tokens](https://edstem.org/settings/api-tokens). The CLI also reads `~/.config/edstem-cli/token`.

## CLI

`edstem-cli` is designed as AI native, so JSON is the default. List commands return compact summaries; detail commands fetch full records and can export Markdown.

Cases:

```bash
edstem courses
edstem threads 12345 --max 20 --fields id,number,title,flags
edstem thread 12345#42
edstem lessons 12345 --module "Week 2"
edstem thread 67890 --md --output thread.md
```

Quiz and lesson-progress commands mutate your Ed state. Run them only when that is intentional:

```bash
edstem lessons read 12345 Pre-Reading
```

### Quiz answering (beta)

`edstem` can inspect quiz questions and saved responses, answer single- or multi-select questions, amend an answer, and submit the completed slide.

```bash
# Inspect a quiz slide and its saved responses.
edstem lessons quiz 4401
edstem lessons quiz 4401 --responses

# Save an answer. Repeat --choice for multi-select questions.
edstem lessons quiz 4401 --answer 991 --choice 2
edstem lessons quiz 4401 --answer 991 --choice 2 --choice 4 --amend

# Submit all saved answers for the slide.
edstem lessons quiz 4401 --submit
```

This feature is beta because Ed's quiz endpoints are not part of a stable public API. Review the selected question and choices before writing, and treat `--submit` as final unless the course allows another attempt.

Use `edstem --help` for the complete command reference. Raw Ed XML stays out of thread JSON unless you pass `--include-html`.

## MCP

### Local

Configure an MCP client to launch the stdio server:

```json
{
  "mcpServers": {
    "edstem": {
      "command": "edstem-mcp",
      "env": {
        "ED_API_TOKEN": "your-token"
      }
    }
  }
}
```

### Hosted

Add [`https://edstem.tuuhub.com/mcp`](https://edstem.tuuhub.com/mcp) as a Streamable HTTP MCP server. Your client opens the OAuth flow, where you provide an Ed API token and approve the requested access.

Local adapters receive your Ed token directly. The hosted server encrypts tokens at rest, maps them to OAuth identities, and requires a separate write scope for quiz and lesson-progress mutations.

## Agent skill

```bash
npx skills add https://github.com/bunizao/edstem-cli

# Inspect metadata or regenerate the tracked reference.
edstem skills
edstem skills generate
```

[`SKILL.md`](SKILL.md) is the canonical agent reference. Its CLI table and MCP tool list are generated from the implementation, and CI rejects drift.

## Self-hosting

The hosted adapter uses Bun, Streamable HTTP, OAuth, encrypted Ed tokens, and SQLite.

```bash
cp .env.example .env
# Set MASTER_KEY and PUBLIC_BASE_URL.
docker compose up -d
```

The image exposes `/healthz`, `/readyz`, and `/mcp`. SQLite data lives in the `app_data` volume.

## Development

```bash
npm install
npm run check
npm test
npm run build
npm run pack:check
npm run pack:smoke
```

`npm test` runs Vitest for the Node.js CLI and local MCP server, then Bun tests for remote OAuth, security, SQLite, and reconnect behavior.

## License

[MIT](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for migrated remote MCP attribution.
