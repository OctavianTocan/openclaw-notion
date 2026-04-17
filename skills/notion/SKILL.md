---
name: notion
description: Use when the user mentions Notion, links to Notion, asks about Notion pages, or wants to create/read/search/update anything in Notion.
---

# Notion

**Always use the native Notion tools.** Do not use web_fetch, curl, Python scripts, bash helpers, or any other method to interact with Notion.

## Tools

### Reading
- **`notion_search`** — find pages/databases by keyword. Returns IDs, titles, and URLs.
- **`notion_read`** — read raw block contents of a page by UUID. Use when you need block-level structure.
- **`notion_read_markdown`** — read a page as clean markdown. **Prefer this over `notion_read`** for most use cases — the output is human-readable and much smaller.

### Writing
- **`notion_create`** — create a new page under a parent page. Accepts markdown content and an optional title. Returns the new page ID.
- **`notion_append`** — append a text paragraph to the bottom of an existing page.
- **`notion_update_markdown`** — replace a page's entire content with new markdown. Use for full rewrites.
- **`notion_update_page`** — update page properties: title, icon emoji. Use for metadata changes, not content.

### Comments
- **`notion_comment_create`** — add a comment to a page.
- **`notion_comment_list`** — list all comments on a page.

## Routing

Tools automatically use the correct API key based on your agent identity. Wretch hits Tavi's workspace, Alaric hits Esther's workspace. No manual key handling needed. Cross-workspace access is blocked by design.

## Workflow

1. **Find a page** → `notion_search` with keywords
2. **Read a Notion URL** → extract the page UUID from the URL, then `notion_read_markdown`
3. **Read raw blocks** → `notion_read` (only when you need block IDs or structured data)
4. **Create a new page** → find the parent with `notion_search`, then `notion_create` with markdown
5. **Edit a page's content** → `notion_update_markdown` to replace, or `notion_append` to add at the bottom
6. **Change title/icon** → `notion_update_page`
7. **Leave a comment** → `notion_comment_create`

## Extracting UUIDs from Notion URLs

Notion URLs contain the page ID as the last 32 hex characters (no dashes). Convert to UUID format:
`https://www.notion.so/Page-Title-abc123def456...` → take the last 32 chars → insert dashes as `8-4-4-4-12`.

## Rules

- Never use `web_fetch` on Notion URLs. It won't work and wastes a turn.
- Never shell out to `curl` or Python scripts for Notion operations.
- Prefer `notion_read_markdown` over `notion_read` unless you specifically need block-level data.
- If a tool returns a permissions error, tell the user to share the page with their Notion integration.
