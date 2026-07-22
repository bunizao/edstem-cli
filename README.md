# edstem-cli

TypeScript CLI and MCP access for [Ed Discussion](https://edstem.org).

One Ed implementation powers three adapters:

- `edstem`: compact JSON CLI for agents and scripts
- `edstem-mcp`: local stdio MCP server
- remote MCP: OAuth, encrypted Ed tokens, and SQLite for hosted connectors

## Install

```bash
npm install -g edstem-cli
export ED_API_TOKEN="your-token"
edstem user --fields id,name,courses
```

Create a token at [edstem.org/settings/api-tokens](https://edstem.org/settings/api-tokens). The CLI also reads `~/.config/edstem-cli/token`.

The npm package requires Node.js 20 or newer. The hosted remote adapter uses Bun.

## CLI

JSON is the default. List commands return summaries without thread bodies, lesson slides, or repeated user records.

```bash
edstem courses
edstem threads 12345 --max 20 --fields id,number,title,flags
edstem thread 67890
edstem thread 12345#42
edstem lessons 12345 --module "Week 2"
edstem lesson 105199
edstem activity 12345 --max 10
```

Detail commands support Markdown export:

```bash
edstem thread 67890 --md --output thread.md
edstem lesson 105199 --md --output lesson.md
```

Raw Ed XML stays out of thread JSON unless you pass `--include-html`. Use `--pretty` for indented JSON and `--legacy-json` for the pre-0.4 thread shape.

Quiz and lesson-progress commands update your Ed state:

```bash
edstem lessons questions 4401
edstem lessons quiz 4401 --answer 991 --choice 2
edstem lessons quiz 4401 --submit
edstem lessons read 12345 Pre-Reading
```

Run `edstem --help` for the full command list.

## Local MCP

Configure an MCP client to launch the stdio executable:

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

The server exposes courses, lessons, threads, activity, quiz submission, and lesson-progress tools. It returns compact JSON text without a duplicate `structuredContent` payload.

## Agent skill

```bash
npx skills add https://github.com/bunizao/edstem-cli

# Check metadata or regenerate SKILL.md
edstem skills
edstem skills generate
```

`SKILL.md` derives its CLI table and MCP tool list from the code. CI rejects drift.

## Remote MCP

The hosted adapter keeps each Ed token encrypted with AES-256-GCM and resolves it from the requesting OAuth identity. It enforces a separate write scope for quiz and progress mutations.

Public endpoint: [https://edstem.tuuhub.com/mcp](https://edstem.tuuhub.com/mcp)

Self-host with Docker:

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

`npm test` runs Vitest for the Node CLI and stdio MCP, then Bun tests for remote OAuth, security, SQLite, and end-to-end reconnect behavior.

## License

MIT. The migrated remote MCP code retains its MIT notice in `THIRD_PARTY_NOTICES.md`.
