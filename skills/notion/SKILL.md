---
name: notion
description: Use when the user mentions Notion, links to Notion, asks about Notion pages, or wants to create/read/search/update/delete/move/sync anything in Notion.
---

# Notion

**Always use the native Notion tools.** Do not use web_fetch, curl, Python scripts, bash helpers, or any other method to interact with Notion.

## Tools

### Reading
- **`notion_search`** — find pages/databases by keyword. Returns IDs, titles, and URLs.
- **`notion_read`** — read raw block contents of a page by UUID. Use when you need block-level structure.
- **`notion_read_markdown`** — read a page as clean markdown. **Prefer this over `notion_read`** for most use cases.
- **`notion_file_tree`** — recursively enumerate child pages and databases under a page. Returns a tree with `{ title, id, url, type, children }`. Use `max_depth` to control recursion (default 3).

### Writing
- **`notion_create`** — create a new page under a parent page. Accepts markdown and optional title. Returns `{ url, response }`.
- **`notion_append`** — append a text paragraph to the bottom of an existing page.
- **`notion_update_markdown`** — replace a page's entire content with new markdown. Returns `{ url, response }`.
- **`notion_update_page`** — update page properties: title, icon emoji. Returns `{ url, response }`.

### Database
- **`notion_query`** — query a database with optional `filter` (JSON string) and `sorts` (JSON string). Falls back to dataSources.query if databases.query fails. Returns page objects with properties, IDs, and URLs.

### Page lifecycle
- **`notion_delete`** — move a page to trash. Uses `in_trash: true`.
- **`notion_move`** — reparent a page under a new parent. Parameters: `page_id`, `new_parent_id`.
- **`notion_publish`** — attempt to toggle public sharing. Currently a read-only stub (the Notion API does not expose publish/unpublish). Returns the page's existing `url` and `public_url`.

### Sync
- **`notion_sync`** — bidirectional sync between a local markdown file and a Notion page.
  - `direction: "push"` — local file → Notion (creates page if no `page_id`/`notion_id`, updates if exists)
  - `direction: "pull"` — Notion → local file
  - `direction: "auto"` (default) — compares mtimes, newer wins
  - Handles YAML frontmatter: reads `notion_id` to find the paired page, writes `notion_id` back after creation
  - Requires `parent_id` when creating a new page from a local file

### Comments
- **`notion_comment_create`** — add a comment to a page.
- **`notion_comment_list`** — list all comments on a page.

### Diagnostics
- **`notion_help`** — return documentation for all Notion tools (or a specific one with `tool_name`). No API calls.
- **`notion_doctor`** — run read-only diagnostics: API connectivity, per-agent key routing, SDK/plugin versions.

## Routing

Tools automatically use the correct API key based on your agent identity. Wretch hits Tavi's workspace, Alaric hits Esther's workspace. No manual key handling needed. Cross-workspace access is blocked by design.

## Workflow

1. **Find a page** → `notion_search` with keywords
2. **Read a Notion URL** → extract the page UUID from the URL, then `notion_read_markdown`
3. **Browse a page tree** → `notion_file_tree` with the root page ID
4. **Read raw blocks** → `notion_read` (only when you need block IDs or structured data)
5. **Query a database** → `notion_query` with `database_id` and optional filter/sorts JSON
6. **Create a new page** → find the parent with `notion_search`, then `notion_create` with markdown
7. **Edit a page's content** → `notion_update_markdown` to replace, or `notion_append` to add at the bottom
8. **Change title/icon** → `notion_update_page`
9. **Move a page** → `notion_move` with the page ID and new parent ID
10. **Delete a page** → `notion_delete` (moves to trash)
11. **Sync a local file** → `notion_sync` with `path` and `direction`
12. **Leave a comment** → `notion_comment_create`
13. **Check health** → `notion_doctor` to verify connectivity and configuration

## Extracting UUIDs from Notion URLs

Notion URLs contain the page ID as the last 32 hex characters (no dashes). Convert to UUID format:
`https://www.notion.so/Page-Title-abc123def456...` → take the last 32 chars → insert dashes as `8-4-4-4-12`.

## Rules

- Never use `web_fetch` on Notion URLs. It won't work and wastes a turn.
- Never shell out to `curl` or Python scripts for Notion operations.
- Prefer `notion_read_markdown` over `notion_read` unless you specifically need block-level data.
- If a tool returns a permissions error, tell the user to share the page with their Notion integration.
- All create/update tools now surface the page `url` at the top level of the response.
