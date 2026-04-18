# Changelog

All notable changes to openclaw-notion are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `notion_logs_read` tool for querying the SQLite audit trail directly from agents (PR #9, closes #5)
- `readAuditLogs()` in `src/audit.ts` with full filter support: agent, session, operation, tool name, status, page/database ID, time range, and optional raw HTTP payload JOINs

### Fixed
- `notion_file_tree` now discovers child pages created via `pages.create()` that don't appear as `child_page` blocks in block-children listings (PR #7, closes #4)
- Audit logger wired into all 17 tools via `withAudit()` wrapper — previously the logger existed in `src/audit.ts` but was never called (PR #8, closes #6)

## [1.0.0] - 2026-04-18

### Added
- 18 Notion tools: search, read, read_markdown, append, create, update_page, update_markdown, comment_create, comment_list, query, delete, move, publish, file_tree, sync, help, doctor
- Per-agent API key isolation with cached client pool (`~/.config/notion/api_key_{id}`)
- Bidirectional markdown sync (push/pull/auto) with YAML frontmatter round-tripping via gray-matter
- Database query with automatic `dataSources.query` fallback for data source UUIDs
- Recursive file-tree walker with configurable depth
- Plugin diagnostics tool (`notion_doctor`) scanning all configured agents
- SQLite audit logger (`src/audit.ts`) with WAL mode, operation tracking, and raw request/response storage
- Markdown page API support for Notion API 2026-03-11 (`retrieveMarkdown`, `updateMarkdown`)
- TypeBox parameter schemas for all tools
- CI quality workflow: Biome linting, TypeScript checking, Vitest tests
- TSDoc on all exports
- Comprehensive test suite: core tools, query, sync, compound flows, auth isolation, secondary agent, diagnostics
- MIT license

### Changed
- Migrated to official OpenClaw Plugin SDK (`definePluginEntry`)
- Refactored into clean module structure: `tools/`, `client.ts`, `auth.ts`, `format.ts`, `helpers.ts`, `types.ts`
- Factory pattern for per-agent context
- Query results trimmed to essential fields (id, object, url, properties)

[Unreleased]: https://github.com/OctavianTocan/openclaw-notion/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/OctavianTocan/openclaw-notion/releases/tag/v1.0.0
