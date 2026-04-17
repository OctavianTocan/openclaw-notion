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
 * Agent IDs the plugin recognises out of the box.
 * Additional agents are discovered at runtime by scanning `~/.config/notion/api_key_*` files.
 */
export const KNOWN_AGENT_IDS = ['default', 'gf_agent'] as const;
