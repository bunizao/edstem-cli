# Unify the CLI and MCP runtimes in one TypeScript repository

The project will use one canonical TypeScript Ed implementation with CLI, stdio MCP, and remote MCP adapters in this repository. Node.js 20+ is the npm and local runtime, while the remote OAuth adapter may keep Bun-specific SQLite internals; this removes cross-repository protocol drift without forcing remote identity machinery into local agent workflows.
