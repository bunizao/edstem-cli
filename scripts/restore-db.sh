#!/usr/bin/env bash
set -euo pipefail

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required for restores." >&2
  exit 1
fi

BACKUP_DB="${1:-}"
TARGET_DB="${2:-.data/edstem-mcp.db}"

if [[ -z "${BACKUP_DB}" ]]; then
  echo "Usage: scripts/restore-db.sh <backup-path> [target-db-path]" >&2
  exit 1
fi

if [[ ! -f "${BACKUP_DB}" ]]; then
  echo "Backup not found: ${BACKUP_DB}" >&2
  exit 1
fi

if [[ "$(sqlite3 "${BACKUP_DB}" "PRAGMA integrity_check;")" != "ok" ]]; then
  echo "Backup failed integrity_check: ${BACKUP_DB}" >&2
  exit 1
fi

mkdir -p "$(dirname "${TARGET_DB}")"
cp "${BACKUP_DB}" "${TARGET_DB}"
echo "Restored ${BACKUP_DB} to ${TARGET_DB}"
