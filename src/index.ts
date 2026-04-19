/**
 * openclaw-notion — OpenClaw plugin entry point.
 *
 * Registers 18 Notion tools with the OpenClaw plugin SDK. Each tool
 * resolves an agent-scoped Notion client via {@link getClient}, ensuring
 * workspace isolation between agents.
 *
 * @module
 */

import { Type } from '@sinclair/typebox';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import type { Operation } from './audit.js';
import { logOperation, setAuditContext } from './audit.js';
import { getClient, getMarkdownPagesApi } from './client.js';
import { DEFAULT_PAGE_SIZE } from './constants.js';
import { asJsonContent, asTextContent, wrapPageResponse } from './format.js';
import { findTitlePropertyName } from './helpers.js';
import { runNotionDoctor } from './tools/doctor.js';
import { getNotionFileTree } from './tools/file-tree.js';
import { getNotionHelp } from './tools/help.js';
import { readNotionLogs } from './tools/logs.js';
import { deleteNotionPage, moveNotionPage, publishNotionPage } from './tools/pages.js';
import { queryNotionDatabase } from './tools/query.js';
import { syncNotionFile } from './tools/sync.js';
import type { AnyPage, SyncParams } from './types.js';

// ── Re-exports for test access ──────────────────────────────────────────
export { getClient, getMarkdownPagesApi } from './client.js';
export { NOTION_VERSION } from './constants.js';
export { runNotionDoctor } from './tools/doctor.js';
export { getNotionFileTree } from './tools/file-tree.js';
export { getNotionHelp } from './tools/help.js';
export { readNotionLogs } from './tools/logs.js';
export { deleteNotionPage, moveNotionPage, publishNotionPage } from './tools/pages.js';
export { queryNotionDatabase } from './tools/query.js';
export {
  appendMissingChildTags,
  escapeTagAttribute,
  escapeTagText,
  extractNotionErrorDetail,
  normalizeItalics,
  syncNotionFile,
} from './tools/sync.js';

/**
 * Build a single paragraph block for the Notion append endpoint.
 *
 * @param text - Plain text content for the paragraph.
 * @returns A block object ready for `blocks.children.append`.
 */
const textBlock = (text: string) => ({
  object: 'block' as const,
  type: 'paragraph' as const,
  paragraph: {
    rich_text: [{ type: 'text' as const, text: { content: text } }],
  },
});

/**
 * Audit-logging wrapper for tool execution.
 *
 * Measures wall-clock duration, sets the agent-scoped audit context,
 * and logs both success and error outcomes to the SQLite audit trail.
 * This avoids duplicating the try/catch + logOperation boilerplate in
 * every tool's execute() body.
 */
async function withAudit<T>(opts: {
  operation: Operation;
  toolName: string;
  agentId: string | undefined;
  targetPageId?: string;
  targetDatabaseId?: string;
  parentPageId?: string;
  localPath?: string;
  syncDirection?: 'push' | 'pull' | 'auto';
  fn: () => Promise<T>;
}): Promise<T> {
  const start = Date.now();
  // Build the shared audit payload once to avoid duplication between branches.
  const base = {
    operation: opts.operation,
    toolName: opts.toolName,
    targetPageId: opts.targetPageId,
    targetDatabaseId: opts.targetDatabaseId,
    parentPageId: opts.parentPageId,
    localPath: opts.localPath,
    syncDirection: opts.syncDirection,
  };
  // Pass context directly instead of mutating the module-global via
  // setAuditContext, which races when concurrent tool calls overlap.
  setAuditContext({ agentId: opts.agentId ?? 'default' });
  try {
    const result = await opts.fn();
    try {
      logOperation({ ...base, status: 'success', durationMs: Date.now() - start });
    } catch {
      // Audit write failed (SQLite busy, disk error, etc.) — never let a
      // logging fault crash a successful tool call.
    }
    return result;
  } catch (error) {
    try {
      logOperation({
        ...base,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
    } catch {
      // Same: swallow audit failures so the original error propagates.
    }
    throw error;
  }
}

// ── Plugin definition ───────────────────────────────────────────────────

export default definePluginEntry({
  id: 'notion',
  name: 'Notion',
  description: 'Notion API for creating and managing pages, databases, and blocks.',
  register(api) {
    // --- notion_search ---
    api.registerTool((ctx) => ({
      name: 'notion_search',
      label: 'Notion Search',
      description:
        'Search the Notion workspace for pages or databases. Returns matching items with their IDs.',
      parameters: Type.Object({
        query: Type.String({
          description: 'The text to search for across page titles and contents.',
        }),
      }),
      async execute(_id, params) {
        return withAudit({
          operation: 'search',
          toolName: 'notion_search',
          agentId: ctx.agentId,
          fn: async () => {
            const notion = getClient(ctx.agentId);
            return asJsonContent(
              (await notion.search({ query: params.query, page_size: 10 })).results
            );
          },
        });
      },
    }));

    // --- notion_read ---
    api.registerTool((ctx) => ({
      name: 'notion_read',
      label: 'Notion Read',
      description: 'Read the raw block contents of a Notion page using its UUID.',
      parameters: Type.Object({
        page_id: Type.String({ description: 'The UUID of the Notion page to read.' }),
      }),
      async execute(_id, params) {
        return withAudit({
          operation: 'read',
          toolName: 'notion_read',
          agentId: ctx.agentId,
          targetPageId: params.page_id,
          fn: async () => {
            const notion = getClient(ctx.agentId);
            return asJsonContent(
              (await notion.blocks.children.list({ block_id: params.page_id })).results
            );
          },
        });
      },
    }));

    // --- notion_append ---
    api.registerTool((ctx) => ({
      name: 'notion_append',
      label: 'Notion Append',
      description: 'Append a simple text paragraph block to the bottom of a Notion page.',
      parameters: Type.Object({
        page_id: Type.String({ description: 'The UUID of the target Notion page.' }),
        text: Type.String({ description: 'The plain text content to append.' }),
      }),
      async execute(_id, params) {
        return withAudit({
          operation: 'append',
          toolName: 'notion_append',
          agentId: ctx.agentId,
          targetPageId: params.page_id,
          fn: async () => {
            const notion = getClient(ctx.agentId);
            return asJsonContent(
              (
                await notion.blocks.children.append({
                  block_id: params.page_id,
                  children: [textBlock(params.text)],
                })
              ).results
            );
          },
        });
      },
    }));

    // --- notion_create ---
    api.registerTool((ctx) => ({
      name: 'notion_create',
      label: 'Notion Create',
      description: 'Create a Notion page under a parent page using markdown.',
      parameters: Type.Object({
        parent_id: Type.String({ description: 'The UUID of the parent Notion page.' }),
        markdown: Type.String({ description: 'The page body as markdown.' }),
        title: Type.Optional(Type.String({ description: 'Optional page title.' })),
      }),
      async execute(_id, params) {
        return withAudit({
          operation: 'create',
          toolName: 'notion_create',
          agentId: ctx.agentId,
          parentPageId: params.parent_id,
          fn: async () => {
            const notion = getClient(ctx.agentId);
            const response = (await notion.pages.create({
              parent: { page_id: params.parent_id },
              properties: params.title
                ? {
                    title: {
                      title: [{ type: 'text', text: { content: params.title } }],
                    },
                  }
                : undefined,
              markdown: params.markdown,
            })) as AnyPage;
            return asJsonContent(wrapPageResponse(response));
          },
        });
      },
    }));

    // --- notion_read_markdown ---
    api.registerTool((ctx) => ({
      name: 'notion_read_markdown',
      label: 'Notion Read Markdown',
      description: 'Read a Notion page as markdown.',
      parameters: Type.Object({
        page_id: Type.String({ description: 'The UUID of the Notion page to read.' }),
      }),
      async execute(_id, params) {
        return withAudit({
          operation: 'read',
          toolName: 'notion_read_markdown',
          agentId: ctx.agentId,
          targetPageId: params.page_id,
          fn: async () => {
            return asJsonContent(
              await getMarkdownPagesApi(getClient(ctx.agentId)).retrieveMarkdown({
                page_id: params.page_id,
              })
            );
          },
        });
      },
    }));

    // --- notion_update_markdown ---
    api.registerTool((ctx) => ({
      name: 'notion_update_markdown',
      label: 'Notion Update Markdown',
      description: 'Replace the content of a Notion page with markdown.',
      parameters: Type.Object({
        page_id: Type.String({ description: 'The UUID of the Notion page to update.' }),
        content: Type.String({ description: 'The new markdown content for the page.' }),
      }),
      async execute(_id, params) {
        return withAudit({
          operation: 'update_markdown',
          toolName: 'notion_update_markdown',
          agentId: ctx.agentId,
          targetPageId: params.page_id,
          fn: async () => {
            const notion = getClient(ctx.agentId);
            const response = await getMarkdownPagesApi(notion).updateMarkdown({
              page_id: params.page_id,
              type: 'replace_content',
              replace_content: { new_str: params.content },
            });
            const page = (await notion.pages.retrieve({ page_id: params.page_id })) as AnyPage;
            return asJsonContent({ url: page.url ?? null, response });
          },
        });
      },
    }));

    // --- notion_update_page ---
    api.registerTool((ctx) => ({
      name: 'notion_update_page',
      label: 'Notion Update Page',
      description: 'Update a Notion page title and/or icon.',
      parameters: Type.Object({
        page_id: Type.String({ description: 'The UUID of the Notion page to update.' }),
        title: Type.Optional(Type.String({ description: 'Optional new page title.' })),
        icon_emoji: Type.Optional(
          Type.String({ description: 'Optional emoji icon for the page.' })
        ),
      }),
      async execute(_id, params) {
        return withAudit({
          operation: 'update',
          toolName: 'notion_update_page',
          agentId: ctx.agentId,
          targetPageId: params.page_id,
          fn: async () => {
            const notion = getClient(ctx.agentId);
            const currentPage = (await notion.pages.retrieve({
              page_id: params.page_id,
            })) as AnyPage;
            const titleProperty = findTitlePropertyName(currentPage.properties) ?? 'title';
            const response = await notion.pages.update({
              page_id: params.page_id,
              icon: params.icon_emoji ? { type: 'emoji', emoji: params.icon_emoji } : undefined,
              properties: params.title
                ? {
                    [titleProperty]: {
                      title: [{ type: 'text', text: { content: params.title } }],
                    },
                  }
                : undefined,
            });
            return asJsonContent(wrapPageResponse(response));
          },
        });
      },
    }));

    // --- notion_comment_create ---
    api.registerTool((ctx) => ({
      name: 'notion_comment_create',
      label: 'Notion Comment Create',
      description: 'Create a comment on a Notion page.',
      parameters: Type.Object({
        page_id: Type.String({ description: 'The UUID of the Notion page to comment on.' }),
        text: Type.String({ description: 'The comment text.' }),
      }),
      async execute(_id, params) {
        return withAudit({
          operation: 'comment_create',
          toolName: 'notion_comment_create',
          agentId: ctx.agentId,
          targetPageId: params.page_id,
          fn: async () => {
            return asJsonContent(
              await getClient(ctx.agentId).comments.create({
                parent: { page_id: params.page_id },
                rich_text: [{ type: 'text', text: { content: params.text } }],
              })
            );
          },
        });
      },
    }));

    // --- notion_comment_list ---
    api.registerTool((ctx) => ({
      name: 'notion_comment_list',
      label: 'Notion Comment List',
      description:
        'List comments on a Notion page. Set include_all_blocks to true to also retrieve inline comments on child blocks (paragraphs, headings, etc.), not just page-level comments.',
      parameters: Type.Object({
        page_id: Type.String({
          description: 'The UUID of the Notion page whose comments to list.',
        }),
        include_all_blocks: Type.Optional(
          Type.Boolean({
            description:
              'When true, also fetches inline comments from every child block on the page. Defaults to false (page-level comments only).',
          })
        ),
      }),
      async execute(_id, params) {
        return withAudit({
          operation: 'comment_list',
          toolName: 'notion_comment_list',
          agentId: ctx.agentId,
          targetPageId: params.page_id,
          fn: async () => {
            const notion = getClient(ctx.agentId);

            // Page-level comments (always fetched).
            const pageComments = (await notion.comments.list({ block_id: params.page_id })).results;

            if (!params.include_all_blocks) {
              return asJsonContent(pageComments);
            }

            // Inline comments live on individual child blocks, not the page
            // itself. Walk all block children and collect their comments.
            const allComments = [...pageComments];
            const seenIds = new Set(pageComments.map((c: { id: string }) => c.id));

            let startCursor: string | undefined;
            do {
              const blocks = await notion.blocks.children.list({
                block_id: params.page_id,
                start_cursor: startCursor,
                page_size: DEFAULT_PAGE_SIZE,
              });

              for (const block of blocks.results) {
                const b = block as { id: string };
                try {
                  const blockComments = (await notion.comments.list({ block_id: b.id })).results;
                  for (const comment of blockComments) {
                    const c = comment as { id: string };
                    if (!seenIds.has(c.id)) {
                      seenIds.add(c.id);
                      allComments.push(comment);
                    }
                  }
                } catch {
                  // Some block types don't support comments — skip silently.
                }
              }

              startCursor = blocks.next_cursor ?? undefined;
            } while (startCursor);

            return asJsonContent(allComments);
          },
        });
      },
    }));

    // --- notion_query ---
    api.registerTool((ctx) => ({
      name: 'notion_query',
      label: 'Notion Query',
      description: 'Query a Notion database or data source with optional filter and sort JSON.',
      parameters: Type.Object({
        database_id: Type.String({ description: 'Database or data source ID.' }),
        filter: Type.Optional(Type.String({ description: 'Optional filter JSON string.' })),
        sorts: Type.Optional(Type.String({ description: 'Optional sorts JSON string.' })),
        page_size: Type.Optional(
          Type.Number({ description: `Optional page size, defaults to ${DEFAULT_PAGE_SIZE}.` })
        ),
      }),
      async execute(_id, params) {
        return withAudit({
          operation: 'query',
          toolName: 'notion_query',
          agentId: ctx.agentId,
          targetDatabaseId: params.database_id,
          fn: async () => {
            return asJsonContent(await queryNotionDatabase(getClient(ctx.agentId), params));
          },
        });
      },
    }));

    // --- notion_delete ---
    api.registerTool((ctx) => ({
      name: 'notion_delete',
      label: 'Notion Delete',
      description: 'Move a Notion page to trash.',
      parameters: Type.Object({ page_id: Type.String({ description: 'Page ID to trash.' }) }),
      async execute(_id, params) {
        return withAudit({
          operation: 'delete',
          toolName: 'notion_delete',
          agentId: ctx.agentId,
          targetPageId: params.page_id,
          fn: async () => {
            return asJsonContent(await deleteNotionPage(getClient(ctx.agentId), params));
          },
        });
      },
    }));

    // --- notion_move ---
    api.registerTool((ctx) => ({
      name: 'notion_move',
      label: 'Notion Move',
      description: 'Move a page under a new parent page.',
      parameters: Type.Object({
        page_id: Type.String({ description: 'Page ID to move.' }),
        new_parent_id: Type.String({ description: 'Destination parent page ID.' }),
      }),
      async execute(_id, params) {
        return withAudit({
          operation: 'move',
          toolName: 'notion_move',
          agentId: ctx.agentId,
          targetPageId: params.page_id,
          parentPageId: params.new_parent_id,
          fn: async () => {
            return asJsonContent(await moveNotionPage(getClient(ctx.agentId), params));
          },
        });
      },
    }));

    // --- notion_publish ---
    api.registerTool((ctx) => ({
      name: 'notion_publish',
      label: 'Notion Publish',
      description:
        'Attempt to toggle public sharing. Returns an explanatory stub if the Notion API does not support it.',
      parameters: Type.Object({
        page_id: Type.String({ description: 'Page ID to publish or unpublish.' }),
        published: Type.Optional(
          Type.Boolean({ description: 'Desired public state, defaults to true.' })
        ),
      }),
      async execute(_id, params) {
        return withAudit({
          operation: 'update',
          toolName: 'notion_publish',
          agentId: ctx.agentId,
          targetPageId: params.page_id,
          fn: async () => {
            return asJsonContent(await publishNotionPage(getClient(ctx.agentId), params));
          },
        });
      },
    }));

    // --- notion_file_tree ---
    api.registerTool((ctx) => ({
      name: 'notion_file_tree',
      label: 'Notion File Tree',
      description: 'Recursively enumerate child pages and child databases.',
      parameters: Type.Object({
        page_id: Type.String({ description: 'Root page ID.' }),
        max_depth: Type.Optional(
          Type.Number({ description: 'Maximum recursion depth, defaults to 3.' })
        ),
      }),
      async execute(_id, params) {
        return withAudit({
          operation: 'file_tree',
          toolName: 'notion_file_tree',
          agentId: ctx.agentId,
          targetPageId: params.page_id,
          fn: async () => {
            return asJsonContent(await getNotionFileTree(getClient(ctx.agentId), params));
          },
        });
      },
    }));

    // --- notion_sync ---
    api.registerTool((ctx) => ({
      name: 'notion_sync',
      label: 'Notion Sync',
      description: 'Sync a local markdown file with a Notion page using push, pull, or auto mode.',
      parameters: Type.Object({
        path: Type.String({ description: 'Local filesystem path.' }),
        page_id: Type.Optional(Type.String({ description: 'Optional Notion page ID.' })),
        parent_id: Type.Optional(
          Type.String({ description: 'Parent page ID when creating a new page.' })
        ),
        direction: Type.Optional(
          Type.Union([Type.Literal('push'), Type.Literal('pull'), Type.Literal('auto')], {
            description: 'push, pull, or auto. Defaults to "auto".',
          })
        ),
      }),
      async execute(_id, params) {
        // Sync direction is resolved at runtime, so we log the direction from params
        // or fall back to 'auto'. The actual direction chosen is in the result.
        const direction: 'push' | 'pull' | 'auto' = (params as SyncParams).direction ?? 'auto';
        const operation = `sync_${direction}` as Operation;
        return withAudit({
          operation,
          toolName: 'notion_sync',
          agentId: ctx.agentId,
          targetPageId: params.page_id,
          parentPageId: params.parent_id,
          localPath: params.path,
          syncDirection: direction,
          fn: async () => {
            return asJsonContent(
              await syncNotionFile(getClient(ctx.agentId), params as SyncParams)
            );
          },
        });
      },
    }));

    // --- notion_help ---
    api.registerTool((ctx) => ({
      name: 'notion_help',
      label: 'Notion Help',
      description: 'Return static documentation for all Notion tools.',
      parameters: Type.Object({
        tool_name: Type.Optional(Type.String({ description: 'Optional tool name.' })),
      }),
      async execute(_id, params) {
        return withAudit({
          operation: 'help',
          toolName: 'notion_help',
          agentId: ctx.agentId,
          fn: async () => {
            return asTextContent(getNotionHelp(params.tool_name));
          },
        });
      },
    }));

    // --- notion_doctor ---
    api.registerTool((ctx) => ({
      name: 'notion_doctor',
      label: 'Notion Doctor',
      description: 'Run read-only diagnostics for Notion plugin setup.',
      parameters: Type.Object({}),
      async execute() {
        return withAudit({
          operation: 'doctor',
          toolName: 'notion_doctor',
          agentId: ctx.agentId,
          fn: async () => {
            return asJsonContent(await runNotionDoctor(ctx.agentId));
          },
        });
      },
    }));

    // --- notion_logs_read ---
    api.registerTool((ctx) => ({
      name: 'notion_logs_read',
      label: 'Notion Logs Read',
      description:
        'Read audit log entries from the local notion-operations.db. Supports filtering by tool, operation, status, page/database ID, agent, session, and time range.',
      parameters: Type.Object({
        limit: Type.Optional(
          Type.Number({ description: 'Max entries to return (default 20, max 100).' })
        ),
        tool_name: Type.Optional(Type.String({ description: 'Filter by tool name.' })),
        operation: Type.Optional(
          Type.String({ description: 'Filter by operation type (search, read, create, etc.).' })
        ),
        status: Type.Optional(
          Type.Union([Type.Literal('success'), Type.Literal('error')], {
            description: 'Filter by status: "success" or "error".',
          })
        ),
        page_id: Type.Optional(Type.String({ description: 'Filter by target page ID.' })),
        database_id: Type.Optional(Type.String({ description: 'Filter by target database ID.' })),
        since: Type.Optional(
          Type.String({ description: 'ISO timestamp lower bound for entries.' })
        ),
        session_id: Type.Optional(Type.String({ description: 'Filter by session ID.' })),
        agent_id: Type.Optional(Type.String({ description: 'Filter by agent ID.' })),
        include_raw: Type.Optional(
          Type.Boolean({
            description: 'Include raw HTTP request/response payloads (default false).',
          })
        ),
      }),
      async execute(_id, params) {
        return asJsonContent(
          readNotionLogs({
            ...params,
            // Default to the calling agent's context unless explicitly overridden.
            agent_id: params.agent_id ?? ctx.agentId,
          })
        );
      },
    }));
  },
});
