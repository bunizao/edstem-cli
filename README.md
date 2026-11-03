<p align="center"><a href="https://unicorn.tuuhub.com"><img src=".github/assets/hero.jpg" alt="edstem-cli: Ed Discussion from your terminal, scripts and AI agent, part of unicorn" width="100%"></a></p>

# edstem-cli

**Give your AI agent access to Ed Discussion.**

Catch up on the forum, search threads, read lessons, grab slides, and post when you ask. Use it as a CLI, a local MCP server, or a hosted remote MCP server.

[![npm version](https://img.shields.io/npm/v/edstem-cli?logo=npm)](https://www.npmjs.com/package/edstem-cli)
[![CI](https://github.com/bunizao/edstem-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/bunizao/edstem-cli/actions/workflows/ci.yml)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 🦄 Part of [unicorn](https://unicorn.tuuhub.com). Live tools answer what is there now; unicorn answers what changed.
>
> 📖 **[Read the docs](https://unicorn.tuuhub.com/docs/edstem)**

## Set up

Ask your agent (Claude Code, Codex, or anything with a terminal):

```text
Read https://unicorn.tuuhub.com/docs/edstem/agent-setup.md and set up edstem-cli for me.
```

Or by hand:

```bash
npm install -g edstem-cli
edstem auth login
edstem units
```

`edstem auth login` opens Ed's token page and works out your Ed region.

## Use it from

| Where | How |
| --- | --- |
| Claude, ChatGPT or any web AI | Add `https://edstem.tuuhub.com/mcp` as a custom connector (edstem.org accounts; US and EU [deploy their own](https://unicorn.tuuhub.com/docs/developers/edstem)). [Remote MCP](https://unicorn.tuuhub.com/docs/edstem/mcp-server) |
| Claude Code, Codex, Cursor | Run `edstem-mcp`, or install the [agent skill](https://unicorn.tuuhub.com/docs/edstem/reference/skills). |
| Your terminal and scripts | `edstem` prints tables in a terminal and JSON in a pipe. [Scripting](https://unicorn.tuuhub.com/docs/developers/edstem) |

## Study Boooooooooost

Ask in plain language, or run the command yourself:

| Ask your agent | Command |
| --- | --- |
| “What did I miss on the forum?” | `edstem threads UNIT --unread` |
| “Any unanswered questions this week?” | `edstem threads UNIT --unanswered --since 7d` |
| “Find threads about the deadline.” | `edstem threads search UNIT deadline` |
| “Read thread 42 for me.” | `edstem threads read UNIT#42` |
| “What lessons are left in week 2?” | `edstem lessons UNIT --module "Week 2"` |
| “What did I get for assignment 1?” | `edstem grades UNIT assignment 1` |
| “Download this lesson's slides.” | `edstem files get LESSON --dest ./slides` |
| “Archive the whole forum.” | `edstem threads export UNIT --dest ./archive` |

`UNIT` is the course ID or code as Ed shows it. Writes always show a plan and ask first.

## Learn more

- [Install and sign in](https://unicorn.tuuhub.com/docs/edstem/install)
- [Threads](https://unicorn.tuuhub.com/docs/edstem/threads): filters, catch-up, actions
- [Export a forum](https://unicorn.tuuhub.com/docs/edstem/export)
- [Lessons and slides](https://unicorn.tuuhub.com/docs/edstem/lessons-and-slides)
- [Files](https://unicorn.tuuhub.com/docs/edstem/files)
- [Posting](https://unicorn.tuuhub.com/docs/edstem/posting)
- [MCP server](https://unicorn.tuuhub.com/docs/edstem/mcp-server): hosted, local, or your own Worker
- [Configuration](https://unicorn.tuuhub.com/docs/edstem/configuration)
- [Troubleshooting](https://unicorn.tuuhub.com/docs/edstem/troubleshooting)
- [Command reference](https://unicorn.tuuhub.com/docs/edstem/reference)

## Build from source

```bash
npm ci
npm run check
npm test
npm run build
```

## 🦄 Part of unicorn

Live tools answer what is there now; unicorn answers what changed.

| Project | Layer | What it does |
| --- | --- | --- |
| [🦄 unicorn](https://github.com/TuuHub/unicorn) | Memory | Remembers your campus sources and tells your agent what changed. Remote MCP. |
| [moodle-cli](https://github.com/bunizao/moodle-cli) | Live | Moodle. CLI, local and remote MCP. |
| **[edstem-cli](https://github.com/bunizao/edstem-cli)** (you are here) | **Live** | **Ed Discussion. CLI, local and remote MCP.** |
| [ontrack](https://github.com/bunizao/ontrack-cli) | Live | OnTrack and Doubtfire. CLI only. |

📖 [All docs](https://unicorn.tuuhub.com/docs) · [CLIs overview](https://unicorn.tuuhub.com/cli) · [Connect an MCP client](https://unicorn.tuuhub.com/docs/mcp)

## License

[MIT](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for migrated remote MCP attribution.
