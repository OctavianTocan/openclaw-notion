#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# notion-sync.sh — Bidirectional sync for markdown files with Notion pages
#
# Walks a directory for .md files that have `notion_id` in their YAML
# frontmatter. For each file, compares the local mtime against the Notion
# page's last_edited_time and prints which direction (push/pull) is needed.
#
# This is a reference/cron script — it does NOT call the plugin tools
# directly. Pair it with an OpenClaw cron job that invokes notion_sync
# for each file that needs syncing.
#
# Usage:
#   ./notion-sync.sh <directory> [--dry-run]
#
# Requirements:
#   - curl, jq, date, find, grep, sed
#   - NOTION_API_KEY env var (or ~/.config/notion/api_key)
#
# ─────────────────────────────────────────────────────────────────────────

set -euo pipefail

DIR="${1:?Usage: notion-sync.sh <directory> [--dry-run]}"
DRY_RUN="${2:-}"

# Resolve API key
if [[ -z "${NOTION_API_KEY:-}" ]]; then
  KEY_FILE="$HOME/.config/notion/api_key"
  if [[ -f "$KEY_FILE" ]]; then
    NOTION_API_KEY="$(cat "$KEY_FILE" | tr -d '[:space:]')"
  else
    echo "ERROR: No NOTION_API_KEY and $KEY_FILE not found." >&2
    exit 1
  fi
fi

NOTION_VERSION="2026-03-11"

# Get a Notion page's last_edited_time via the API
get_notion_mtime() {
  local page_id="$1"
  local response
  response=$(curl -sS \
    -H "Authorization: Bearer $NOTION_API_KEY" \
    -H "Notion-Version: $NOTION_VERSION" \
    "https://api.notion.com/v1/pages/$page_id" 2>/dev/null)

  local last_edited
  last_edited=$(echo "$response" | jq -r '.last_edited_time // empty' 2>/dev/null)
  if [[ -z "$last_edited" ]]; then
    echo "ERROR" 
    return 1
  fi
  # Convert to epoch seconds
  date -d "$last_edited" +%s 2>/dev/null || echo "ERROR"
}

# Extract notion_id from YAML frontmatter
extract_notion_id() {
  local file="$1"
  # Read between first --- and second ---, extract notion_id value
  sed -n '/^---$/,/^---$/{/^notion_id:/p}' "$file" | sed 's/^notion_id:[[:space:]]*//' | tr -d '[:space:]"'"'"
}

echo "Scanning $DIR for .md files with notion_id..."
echo "──────────────────────────────────────────────"

SYNC_COUNT=0
SKIP_COUNT=0

find "$DIR" -name '*.md' -type f | sort | while IFS= read -r file; do
  notion_id=$(extract_notion_id "$file")
  
  if [[ -z "$notion_id" ]]; then
    continue
  fi

  SYNC_COUNT=$((SYNC_COUNT + 1))
  local_mtime=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null)
  
  notion_mtime=$(get_notion_mtime "$notion_id")
  if [[ "$notion_mtime" == "ERROR" ]]; then
    echo "⚠  $file → notion_id=$notion_id — API error, skipping"
    SKIP_COUNT=$((SKIP_COUNT + 1))
    continue
  fi

  if [[ "$notion_mtime" -gt "$local_mtime" ]]; then
    direction="pull"
    echo "↓  $file → PULL (Notion is newer)"
  elif [[ "$local_mtime" -gt "$notion_mtime" ]]; then
    direction="push"
    echo "↑  $file → PUSH (local is newer)"
  else
    echo "=  $file → IN SYNC"
    continue
  fi

  if [[ "$DRY_RUN" == "--dry-run" ]]; then
    echo "   [dry-run] Would $direction: $file ↔ $notion_id"
  else
    echo "   → Sync needed: $direction $file (notion_id=$notion_id)"
    # In a real cron setup, this would call:
    #   openclaw tool notion_sync --path "$file" --direction "$direction"
    # For now, just log the action needed.
  fi
done

echo "──────────────────────────────────────────────"
echo "Done. Files with notion_id: scanned. Skipped: ${SKIP_COUNT:-0}"
