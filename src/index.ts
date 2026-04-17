import { Type } from "@sinclair/typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { getClient } from "./client.js";
import { DEFAULT_PAGE_SIZE } from "./constants.js";
import { asJsonContent, asTextContent, wrapPageResponse } from "./format.js";
import { findTitlePropertyName } from "./helpers.js";
import { runNotionDoctor } from "./tools/doctor.js";
import { getNotionFileTree } from "./tools/file-tree.js";
import { getNotionHelp } from "./tools/help.js";
import { deleteNotionPage, moveNotionPage, publishNotionPage } from "./tools/pages.js";
import { queryNotionDatabase } from "./tools/query.js";
import { syncNotionFile } from "./tools/sync.js";
import type { AnyPage, MarkdownPageApi, SyncParams } from "./types.js";

export { getClient } from "./client.js";
export { NOTION_VERSION } from "./constants.js";
export { runNotionDoctor } from "./tools/doctor.js";
export { getNotionFileTree } from "./tools/file-tree.js";
export { getNotionHelp } from "./tools/help.js";
export { deleteNotionPage, moveNotionPage, publishNotionPage } from "./tools/pages.js";
export { queryNotionDatabase } from "./tools/query.js";
export { syncNotionFile } from "./tools/sync.js";

const textBlock = (text: string) => ({
  object: "block" as const,
  type: "paragraph" as const,
  paragraph: {
    rich_text: [{ type: "text" as const, text: { content: text } }],
  },
});

const getMarkdownPagesApi = (agentId?: string) =>
  getClient(agentId).pages as typeof getClient extends never ? never : MarkdownPageApi;

export default definePluginEntry({
  id: "notion",
  name: "Notion",
  description: "Notion API for creating and managing pages, databases, and blocks.",
  register(api) {
    api.registerTool((ctx) => ({
      name: "notion_search",
      label: "Notion Search",
      description:
        "Search the Notion workspace for pages or databases. Returns matching items with their IDs.",
      parameters: Type.Object({
        query: Type.String({
          description: "The text to search for across page titles and contents.",
        }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        return asJsonContent((await notion.search({ query: params.query, page_size: 10 })).results);
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_read",
      label: "Notion Read",
      description: "Read the raw block contents of a Notion page using its UUID.",
      parameters: Type.Object({
        page_id: Type.String({ description: "The UUID of the Notion page to read." }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        return asJsonContent(
          (await notion.blocks.children.list({ block_id: params.page_id })).results,
        );
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_append",
      label: "Notion Append",
      description: "Append a simple text paragraph block to the bottom of a Notion page.",
      parameters: Type.Object({
        page_id: Type.String({ description: "The UUID of the target Notion page." }),
        text: Type.String({ description: "The plain text content to append." }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        return asJsonContent(
          (
            await notion.blocks.children.append({
              block_id: params.page_id,
              children: [textBlock(params.text)],
            })
          ).results,
        );
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_create",
      label: "Notion Create",
      description: "Create a Notion page under a parent page using markdown.",
      parameters: Type.Object({
        parent_id: Type.String({ description: "The UUID of the parent Notion page." }),
        markdown: Type.String({ description: "The page body as markdown." }),
        title: Type.Optional(Type.String({ description: "Optional page title." })),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = (await notion.pages.create({
          parent: { page_id: params.parent_id },
          properties: params.title
            ? {
                title: {
                  title: [{ type: "text", text: { content: params.title } }],
                },
              }
            : undefined,
          markdown: params.markdown,
        })) as AnyPage;
        return asJsonContent(wrapPageResponse(response));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_read_markdown",
      label: "Notion Read Markdown",
      description: "Read a Notion page as markdown.",
      parameters: Type.Object({
        page_id: Type.String({ description: "The UUID of the Notion page to read." }),
      }),
      async execute(_id, params) {
        return asJsonContent(
          await getMarkdownPagesApi(ctx.agentId).retrieveMarkdown({ page_id: params.page_id }),
        );
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_update_markdown",
      label: "Notion Update Markdown",
      description: "Replace the content of a Notion page with markdown.",
      parameters: Type.Object({
        page_id: Type.String({ description: "The UUID of the Notion page to update." }),
        content: Type.String({ description: "The new markdown content for the page." }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await getMarkdownPagesApi(ctx.agentId).updateMarkdown({
          page_id: params.page_id,
          type: "replace_content",
          replace_content: { new_str: params.content },
        });
        const page = (await notion.pages.retrieve({ page_id: params.page_id })) as AnyPage;
        return asJsonContent({ url: page.url ?? null, response });
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_update_page",
      label: "Notion Update Page",
      description: "Update a Notion page title and/or icon.",
      parameters: Type.Object({
        page_id: Type.String({ description: "The UUID of the Notion page to update." }),
        title: Type.Optional(Type.String({ description: "Optional new page title." })),
        icon_emoji: Type.Optional(
          Type.String({ description: "Optional emoji icon for the page." }),
        ),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const currentPage = (await notion.pages.retrieve({ page_id: params.page_id })) as AnyPage;
        const titleProperty = findTitlePropertyName(currentPage.properties) ?? "title";
        const response = await notion.pages.update({
          page_id: params.page_id,
          icon: params.icon_emoji ? { type: "emoji", emoji: params.icon_emoji } : undefined,
          properties: params.title
            ? {
                [titleProperty]: {
                  title: [{ type: "text", text: { content: params.title } }],
                },
              }
            : undefined,
        });
        return asJsonContent(wrapPageResponse(response));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_comment_create",
      label: "Notion Comment Create",
      description: "Create a comment on a Notion page.",
      parameters: Type.Object({
        page_id: Type.String({ description: "The UUID of the Notion page to comment on." }),
        text: Type.String({ description: "The comment text." }),
      }),
      async execute(_id, params) {
        return asJsonContent(
          await getClient(ctx.agentId).comments.create({
            parent: { page_id: params.page_id },
            rich_text: [{ type: "text", text: { content: params.text } }],
          }),
        );
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_comment_list",
      label: "Notion Comment List",
      description: "List comments attached to a Notion page.",
      parameters: Type.Object({
        page_id: Type.String({
          description: "The UUID of the Notion page whose comments to list.",
        }),
      }),
      async execute(_id, params) {
        return asJsonContent(
          (await getClient(ctx.agentId).comments.list({ block_id: params.page_id })).results,
        );
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_query",
      label: "Notion Query",
      description: "Query a Notion database or data source with optional filter and sort JSON.",
      parameters: Type.Object({
        database_id: Type.String({ description: "Database or data source ID." }),
        filter: Type.Optional(Type.String({ description: "Optional filter JSON string." })),
        sorts: Type.Optional(Type.String({ description: "Optional sorts JSON string." })),
        page_size: Type.Optional(
          Type.Number({ description: `Optional page size, defaults to ${DEFAULT_PAGE_SIZE}.` }),
        ),
      }),
      async execute(_id, params) {
        return asJsonContent(await queryNotionDatabase(getClient(ctx.agentId), params));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_delete",
      label: "Notion Delete",
      description: "Move a Notion page to trash.",
      parameters: Type.Object({ page_id: Type.String({ description: "Page ID to trash." }) }),
      async execute(_id, params) {
        return asJsonContent(await deleteNotionPage(getClient(ctx.agentId), params));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_move",
      label: "Notion Move",
      description: "Move a page under a new parent page.",
      parameters: Type.Object({
        page_id: Type.String({ description: "Page ID to move." }),
        new_parent_id: Type.String({ description: "Destination parent page ID." }),
      }),
      async execute(_id, params) {
        return asJsonContent(await moveNotionPage(getClient(ctx.agentId), params));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_publish",
      label: "Notion Publish",
      description:
        "Attempt to toggle public sharing. Returns an explanatory stub if the Notion API does not support it.",
      parameters: Type.Object({
        page_id: Type.String({ description: "Page ID to publish or unpublish." }),
        published: Type.Optional(
          Type.Boolean({ description: "Desired public state, defaults to true." }),
        ),
      }),
      async execute(_id, params) {
        return asJsonContent(await publishNotionPage(getClient(ctx.agentId), params));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_file_tree",
      label: "Notion File Tree",
      description: "Recursively enumerate child pages and child databases.",
      parameters: Type.Object({
        page_id: Type.String({ description: "Root page ID." }),
        max_depth: Type.Optional(
          Type.Number({ description: "Maximum recursion depth, defaults to 3." }),
        ),
      }),
      async execute(_id, params) {
        return asJsonContent(await getNotionFileTree(getClient(ctx.agentId), params));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_sync",
      label: "Notion Sync",
      description: "Sync a local markdown file with a Notion page using push, pull, or auto mode.",
      parameters: Type.Object({
        path: Type.String({ description: "Local filesystem path." }),
        page_id: Type.Optional(Type.String({ description: "Optional Notion page ID." })),
        parent_id: Type.Optional(
          Type.String({ description: "Parent page ID when creating a new page." }),
        ),
        direction: Type.Optional(
          Type.String({ description: 'push, pull, or auto. Defaults to "auto".' }),
        ),
      }),
      async execute(_id, params) {
        return asJsonContent(await syncNotionFile(getClient(ctx.agentId), params as SyncParams));
      },
    }));

    api.registerTool(() => ({
      name: "notion_help",
      label: "Notion Help",
      description: "Return static documentation for all Notion tools.",
      parameters: Type.Object({
        tool_name: Type.Optional(Type.String({ description: "Optional tool name." })),
      }),
      async execute(_id, params) {
        return asTextContent(getNotionHelp(params.tool_name));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_doctor",
      label: "Notion Doctor",
      description: "Run read-only diagnostics for Notion plugin setup.",
      parameters: Type.Object({}),
      async execute() {
        return asJsonContent(await runNotionDoctor(ctx.agentId));
      },
    }));
  },
});
