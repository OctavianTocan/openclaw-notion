# openclaw-notion

Native [Notion](https://notion.so) integration for [OpenClaw](https://github.com/openclaw/openclaw). Gives your agents direct access to the Notion API through 9 built-in tools — no scripts, no browser automation, no middleware.

Built on the official [`@notionhq/client`](https://github.com/makenotion/notion-sdk-js) SDK with Notion API **v2026-03-11** (enhanced markdown support).

## Features

- **9 native tools** — search, read, create, update, comment
- **Markdown-first** — create and edit pages with plain markdown instead of Notion's block JSON
- **Multi-agent isolation** — each agent gets its own API key and workspace, routed automatically
- **Zero config** — drop in API keys, register the plugin, restart the gateway

## Tools

| Tool | Description |
|------|-------------|
| `notion_search` | Search pages and databases by keyword |
| `notion_read` | Read raw block contents of a page |
| `notion_read_markdown` | Read a page as clean markdown |
| `notion_create` | Create a new page with markdown content |
| `notion_append` | Append a text paragraph to a page |
| `notion_update_markdown` | Replace a page's content with markdown |
| `notion_update_page` | Update page title and icon |
| `notion_comment_create` | Add a comment to a page |
| `notion_comment_list` | List comments on a page |

## Installation

### 1. Create a Notion integration

Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) and create an internal integration. Copy the API key.

### 2. Store the API key

```bash
mkdir -p ~/.config/notion
echo "ntn_your_api_key_here" > ~/.config/notion/api_key
```

For multi-agent setups, add agent-specific keys:

```bash
echo "ntn_agent_key_here" > ~/.config/notion/api_key_gf_agent
```

The plugin checks for `~/.config/notion/api_key_{agentId}` first, falling back to `~/.config/notion/api_key`.

### 3. Register the plugin

Add to your `openclaw.json`:

```json
{
  "extensions": {
    "entries": {
      "notion": {
        "enabled": true
      }
    },
    "installs": {
      "notion": {
        "source": "path",
        "installPath": "/path/to/openclaw-notion"
      }
    }
  }
}
```

### 4. Build and restart

```bash
cd /path/to/openclaw-notion
pnpm install
pnpm build
openclaw gateway restart
```

## Multi-Agent Routing

Each OpenClaw agent has an `agentId` injected via the plugin context. The plugin uses this to load the correct API key, so agents are isolated to their own Notion workspaces by default.

| Agent | Key file | Workspace |
|-------|----------|-----------|
| `main` | `~/.config/notion/api_key` | Default workspace |
| `gf_agent` | `~/.config/notion/api_key_gf_agent` | Agent-specific workspace |
| Any other | `~/.config/notion/api_key_{id}` → fallback `api_key` | Resolved per key |

Cross-workspace access is blocked by design — each API key only has access to pages shared with its integration.

## Development

```bash
pnpm install       # install dependencies
pnpm build         # compile TypeScript
pnpm test          # run tests (requires real API keys)
```

Tests run against live Notion APIs with real API calls. No mocks. They verify tool behavior and cross-workspace isolation.

## Requirements

- Node.js ≥ 22
- OpenClaw ≥ 2026.3.24
- Notion API key(s) with access to target pages

## License

MIT — see [LICENSE](LICENSE).
