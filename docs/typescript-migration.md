# TypeScript migration

The rewrite ships in verified vertical slices.

## Milestones

1. [x] **Foundation**: add the npm toolchain, domain language, and architecture decision.
2. [x] **Ed core**: migrate transport, parsing, errors, filtering, and compact projections behind one interface.
3. [x] **CLI adapter**: preserve command behavior, default non-TTY output to compact JSON, and add stable machine-readable errors.
4. [x] **MCP adapters**: expose the same Ed operations through local stdio MCP and migrate the remote OAuth runtime without coupling it to local startup.
5. [x] **Acceptance**: pass TypeScript, MCP integration, live-token, package-content, and packed-install checks.
6. [ ] **Release**: publish `edstem-cli@0.4.0` and verify registry installation.

## Acceptance gates

- No Ed Token is committed, logged, or included in test fixtures.
- CLI list commands emit summary projections; detail commands emit full projections only when requested.
- CLI and MCP adapters exercise the same Ed core tests.
- A local command does not perform a separate token-verification request before its requested operation.
- `npm pack` contains both `edstem` and `edstem-mcp` executables.
- The packed package installs and runs on Node.js 20+.
