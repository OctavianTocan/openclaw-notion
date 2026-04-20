/**
 * Static documentation for all Notion tools.
 *
 * Serves as an in-band help system so agents can discover tool names,
 * parameters, and usage examples without leaving the conversation.
 */

import { DEFAULT_PAGE_SIZE } from '../constants.js';
import type { ToolDoc } from '../types.js';

/** Complete catalogue of registered Notion tool documentation. */
export const TOOL_DOCS: ToolDoc[] = [
  {
    name: 'notion_search',
    description: 'Search the Notion workspace for pages or databases.',
    parameters: ['query: string'],
    example: '{"query":"Projects"}',
  },
  {
    name: 'notion_read',
    description: 'Read raw block children for a page.',
    parameters: ['page_id: string'],
    example: '{"page_id":"<page-id>"}',
  },
  {
    name: 'notion_append',
    description: 'Append a text paragraph to a page.',
    parameters: ['page_id: string', 'text: string'],
    example: '{"page_id":"<page-id>","text":"hello"}',
  },
  {
    name: 'notion_create',
    description: 'Create a page under a parent page using markdown.',
    parameters: ['parent_id: string', 'markdown: string', 'title?: string'],
    example: '{"parent_id":"<page-id>","title":"Draft","markdown":"# Hello"}',
  },
  {
    name: 'notion_read_markdown',
    description: 'Read a page as markdown.',
    parameters: ['page_id: string'],
    example: '{"page_id":"<page-id>"}',
  },
  {
    name: 'notion_update_markdown',
    description: "Replace a page's content with markdown.",
    parameters: ['page_id: string', 'content: string'],
    example: '{"page_id":"<page-id>","content":"# Updated"}',
  },
  {
    name: 'notion_update_page',
    description: 'Update a page title and/or icon.',
    parameters: ['page_id: string', 'title?: string', 'icon_emoji?: string'],
    example: '{"page_id":"<page-id>","title":"Renamed","icon_emoji":"🧪"}',
  },
  {
    name: 'notion_comment_create',
    description: 'Create a page comment.',
    parameters: ['page_id: string', 'text: string'],
    example: '{"page_id":"<page-id>","text":"Ship it"}',
  },
  {
    name: 'notion_comment_list',
    description: 'List comments for a page.',
    parameters: ['page_id: string'],
    example: '{"page_id":"<page-id>"}',
  },
  {
    name: 'notion_query',
    description: 'Query a database or data source with optional filter and sorts JSON.',
    parameters: [
      'database_id: string',
      'filter?: JSON string',
      'sorts?: JSON string',
      `page_size?: number (default ${DEFAULT_PAGE_SIZE})`,
    ],
    example:
      '{"database_id":"<database-id>","sorts":"[{\\"timestamp\\":\\"last_edited_time\\",\\"direction\\":\\"descending\\"}]"}',
  },
  {
    name: 'notion_delete',
    description: 'Move a page to trash.',
    parameters: ['page_id: string'],
    example: '{"page_id":"<page-id>"}',
  },
  {
    name: 'notion_move',
    description: 'Move a page under another page.',
    parameters: ['page_id: string', 'new_parent_id: string'],
    example: '{"page_id":"<page-id>","new_parent_id":"<parent-id>"}',
  },
  {
    name: 'notion_publish',
    description:
      'Attempt to toggle public sharing. Returns a limitation report when the API cannot do it.',
    parameters: ['page_id: string', 'published?: boolean (default true)'],
    example: '{"page_id":"<page-id>","published":true}',
  },
  {
    name: 'notion_file_tree',
    description: 'Recursively enumerate child pages and child databases.',
    parameters: ['page_id: string', 'max_depth?: number (default 3)'],
    example: '{"page_id":"<page-id>","max_depth":2}',
  },
  {
    name: 'notion_sync',
    description:
      'Sync a markdown file and a Notion page. Uses YAML frontmatter notion_id when present.',
    parameters: [
      'path: string',
      'page_id?: string',
      'parent_id?: string',
      'direction?: "push" | "pull" | "auto" (default auto)',
    ],
    example: '{"path":"./notes/todo.md","parent_id":"<page-id>","direction":"auto"}',
  },
  {
    name: 'notion_help',
    description: 'Return static documentation for Notion tools.',
    parameters: ['tool_name?: string'],
    example: '{"tool_name":"notion_sync"}',
  },
  {
    name: 'notion_doctor',
    description: 'Run read-only diagnostics for API keys, SDK version, and connectivity.',
    parameters: [],
    example: '{}',
  },
  {
    name: 'notion_upload_file',
    description: 'Upload a local file to Notion and attach it as a file block on a page.',
    parameters: [
      'file_path: string',
      'page_id: string',
      'display_name?: string',
      'content_type?: string',
    ],
    example: '{"file_path":"./report.pdf","page_id":"<page-id>","display_name":"Q4 Report.pdf"}',
  },
  {
    name: 'notion_logs_read',
    description:
      'Read audit log entries from the local notion-operations.db with optional filters.',
    parameters: [
      'limit?: number (default 20, max 100)',
      'tool_name?: string',
      'operation?: string',
      'status?: "success" | "error"',
      'page_id?: string',
      'database_id?: string',
      'since?: ISO timestamp',
      'session_id?: string',
      'agent_id?: string',
      'include_raw?: boolean (default false)',
    ],
    example: '{"operation":"create","status":"error","limit":10}',
  },
];

/**
 * Generate formatted help text for one or all Notion tools.
 *
 * @param toolName - Specific tool to document, or omit for all tools.
 * @returns Multi-line string with tool name, description, parameters, and example.
 * @throws {Error} When `toolName` does not match any registered tool.
 */
export function getNotionHelp(toolName?: string) {
  const docs = toolName ? TOOL_DOCS.filter((tool) => tool.name === toolName) : TOOL_DOCS;
  if (toolName && docs.length === 0) {
    throw new Error(`Unknown Notion tool: ${toolName}`);
  }

  return docs
    .map(
      (tool) =>
        `${tool.name}\n${tool.description}\nParameters: ${tool.parameters.join(', ')}\nExample: ${tool.example}`
    )
    .join('\n\n');
}
