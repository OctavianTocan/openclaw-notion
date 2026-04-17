/**
 * Notion API version passed to every SDK client instance.
 * Uses the 2026-03-11 release which enables enhanced markdown endpoints.
 */
export const NOTION_VERSION = '2026-03-11';

/**
 * Default number of results per paginated Notion API request.
 * Applied to database queries, block children listing, and file tree walks.
 */
export const DEFAULT_PAGE_SIZE = 100;

/**
 * Baseline agent IDs the plugin recognises before scanning disk.
 * Additional agents are discovered at runtime from `~/.config/notion/api_key_*` files.
 */
export const KNOWN_AGENT_IDS = ['default'] as const;
