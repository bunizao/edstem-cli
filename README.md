# edstem-cli

CLI and MCP access to Ed Discussion for people, scripts, and agents.

[![npm version](https://img.shields.io/npm/v/edstem-cli?logo=npm)](https://www.npmjs.com/package/edstem-cli)
[![CI](https://github.com/bunizao/edstem-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/bunizao/edstem-cli/actions/workflows/ci.yml)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Install

```bash
npm install -g edstem-cli
export EDSTEM_TOKEN="your-token"
edstem auth status
```

Create a token at [edstem.org/settings/api-tokens](https://edstem.org/settings/api-tokens). The CLI also reads `~/.config/edstem-cli/token` and `~/.config/edstem-cli/config.yaml`.

## Command model

Commands follow `edstem <plural-noun> [verb] [scope] [id] [flags]`. The canonical enrolment noun is `units`; `courses` and `projects` are equivalent aliases.

```bash
edstem units
edstem courses FIT1045
edstem threads 12345 --max 20 --fields id,number,title
edstem threads show 12345#42
edstem threads read 12345#42
edstem lessons 12345 --module "Week 2"
edstem lessons show 67890
```

Omitted verbs are inferred when the arguments are unambiguous. `read` always emits Markdown and never changes upstream state.

Slide facets use one read-only command so the verb vocabulary stays consistent:

```bash
edstem slides show 4401
edstem slides show 4401 --section questions
edstem slides show 4401 --section responses
```

## Mutations

Mutations are visible in help, print a plan, and prompt with `y/N` in an interactive terminal. Non-interactive callers must pass `--yes`. `--dry-run` prints the plan without sending a write request.

```bash
edstem lessons mark-read 12345 Pre-Reading --dry-run
edstem lessons mark-read 12345 Pre-Reading --yes

# Save one answer, then submit all saved answers for the slide.
edstem slides submit 4401 --question 991 --choice 2 --yes
edstem slides submit 4401 --yes
```

## Output and errors

Successful output is a table when stdout is a terminal and JSON when stdout is piped or redirected. Override this with `--json`, `--yaml`, or `--table`; select fields with `--fields a,b`; write to a file with `--output FILE`.

Errors are rendered exactly once on stderr. Usage failures exit 2, authentication failures exit 3, missing entities exit 4, upstream rejections exit 5, and cancellation exits 130.

Run `edstem commands --json` for the full machine-readable command tree, including aliases, positionals, enum values, and mutation markers.

## Environment

| Variable | Purpose |
| --- | --- |
| `EDSTEM_BASE_URL` | Override the Ed JSON API base URL. |
| `EDSTEM_TOKEN` | Provide the Ed API token. |
| `EDSTEM_CONFIG` | Override the local config file path. |

## MCP

The package also installs `edstem-mcp`, a local stdio MCP server using the same `EDSTEM_TOKEN`. A hosted Streamable HTTP server is available at `https://edstem.tuuhub.com/mcp` and uses OAuth.

```json
{
  "mcpServers": {
    "edstem": {
      "command": "edstem-mcp",
      "env": {
        "EDSTEM_TOKEN": "your-token"
      }
    }
  }
}
```

## Agent skill

```bash
npx skills add https://github.com/bunizao/edstem-cli
edstem skills generate
```

The tracked [SKILL.md](SKILL.md) is generated from `edstem commands --json` plus the MCP tool catalog. CI rejects drift. The shared CLI contract is loaded from the tagged `@bunizao/cli-kit` v0.1.0 source archive, without a sibling development checkout.

## License

[MIT](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for migrated remote MCP attribution.
