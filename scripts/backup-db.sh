#!/usr/bin/env bash
set -euo pipefail

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required for backups." >&2
  exit 1
fi

SOURCE_DB="${1:-.data/edstem-mcp.db}"
TARGET_DB="${2:-backups/edstem-mcp-$(date +%Y%m%d-%H%M%S).db}"

if [[ ! -f "${SOURCE_DB}" ]]; then
  echo "Database not found: ${SOURCE_DB}" >&2
  exit 1
fi

mkdir -p "$(dirname "${TARGET_DB}")"
sqlite3 "${SOURCE_DB}" ".timeout 5000" ".backup '${TARGET_DB}'"
echo "Backup written to ${TARGET_DB}"
