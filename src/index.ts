import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { Client } from "@notionhq/client";
import { getNotionApiKey } from "./auth.js";

/**
 * Per-agent Notion client cache.
 * Each agentId gets its own Client instance backed by its own API key.
 */
const clients = new Map<string, Client>();

function getClient(agentId?: string): Client {
  const cacheKey = agentId || "default";
  if (!clients.has(cacheKey)) {
    clients.set(
      cacheKey,
      new Client({
        auth: getNotionApiKey(agentId),
        notionVersion: "2026-03-11",
      })
    );
  }
  return clients.get(cacheKey)!;
}

function asJsonContent(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
    details: null,
  };
}

export default definePluginEntry({
  id: "notion",
  name: "Notion",
  description:
    "Notion API for creating and managing pages, databases, and blocks.",
  register(api) {
    // --- notion_search ---
    api.registerTool((ctx) => ({
      name: "notion_search",
      label: "Notion Search",
      description:
        "Search the Notion workspace for pages or databases. Returns matching items with their IDs.",
      parameters: Type.Object({
        query: Type.String({
          description:
            "The text to search for across page titles and contents.",
        }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await notion.search({
          query: params.query,
          page_size: 10,
        });
        return asJsonContent(response.results);
      },
    }));

    // --- notion_read ---
    api.registerTool((ctx) => ({
      name: "notion_read",
      label: "Notion Read",
      description:
        "Read the raw block contents of a Notion page using its UUID.",
      parameters: Type.Object({
        page_id: Type.String({
          description: "The UUID of the Notion page to read.",
        }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await notion.blocks.children.list({
          block_id: params.page_id,
        });
        return asJsonContent(response.results);
      },
    }));

    // --- notion_append ---
    api.registerTool((ctx) => ({
      name: "notion_append",
      label: "Notion Append",
      description:
        "Append a simple text paragraph block to the bottom of a Notion page.",
      parameters: Type.Object({
        page_id: Type.String({
          description: "The UUID of the target Notion page.",
        }),
        text: Type.String({
          description: "The plain text content to append.",
        }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await notion.blocks.children.append({
          block_id: params.page_id,
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  {
                    type: "text",
                    text: { content: params.text },
                  },
                ],
              },
            },
          ],
        });
        return asJsonContent(response.results);
      },
    }));

    // --- notion_create ---
    api.registerTool((ctx) => ({
      name: "notion_create",
      label: "Notion Create",
      description: "Create a Notion page under a parent page using markdown.",
      parameters: Type.Object({
        parent_id: Type.String({
          description: "The UUID of the parent Notion page.",
        }),
        markdown: Type.String({
          description: "The page body as markdown.",
        }),
        title: Type.Optional(
          Type.String({
            description: "Optional page title.",
          })
        ),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await notion.pages.create({
          parent: { page_id: params.parent_id },
          properties: params.title
            ? {
                title: {
                  title: [{ type: "text", text: { content: params.title } }],
                },
              }
            : undefined,
          markdown: params.markdown,
        });
        return asJsonContent(response);
      },
    }));

    // --- notion_read_markdown ---
    api.registerTool((ctx) => ({
      name: "notion_read_markdown",
      label: "Notion Read Markdown",
      description: "Read a Notion page as markdown.",
      parameters: Type.Object({
        page_id: Type.String({
          description: "The UUID of the Notion page to read.",
        }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await notion.pages.retrieveMarkdown({
          page_id: params.page_id,
        });
        return asJsonContent(response);
      },
    }));

    // --- notion_update_markdown ---
    api.registerTool((ctx) => ({
      name: "notion_update_markdown",
      label: "Notion Update Markdown",
      description: "Replace the content of a Notion page with markdown.",
      parameters: Type.Object({
        page_id: Type.String({
          description: "The UUID of the Notion page to update.",
        }),
        content: Type.String({
          description: "The new markdown content for the page.",
        }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await notion.pages.updateMarkdown({
          page_id: params.page_id,
          type: "replace_content",
          replace_content: { new_str: params.content },
        });
        return asJsonContent(response);
      },
    }));

    // --- notion_update_page ---
    api.registerTool((ctx) => ({
      name: "notion_update_page",
      label: "Notion Update Page",
      description: "Update a Notion page title and/or icon.",
      parameters: Type.Object({
        page_id: Type.String({
          description: "The UUID of the Notion page to update.",
        }),
        title: Type.Optional(
          Type.String({
            description: "Optional new page title.",
          })
        ),
        icon_emoji: Type.Optional(
          Type.String({
            description: "Optional emoji icon for the page.",
          })
        ),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await notion.pages.update({
          page_id: params.page_id,
          icon: params.icon_emoji
            ? { type: "emoji", emoji: params.icon_emoji }
            : undefined,
          properties: params.title
            ? {
                title: {
                  title: [{ type: "text", text: { content: params.title } }],
                },
              }
            : undefined,
        });
        return asJsonContent(response);
      },
    }));

    // --- notion_comment_create ---
    api.registerTool((ctx) => ({
      name: "notion_comment_create",
      label: "Notion Comment Create",
      description: "Create a comment on a Notion page.",
      parameters: Type.Object({
        page_id: Type.String({
          description: "The UUID of the Notion page to comment on.",
        }),
        text: Type.String({
          description: "The comment text.",
        }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await notion.comments.create({
          parent: { page_id: params.page_id },
          rich_text: [{ type: "text", text: { content: params.text } }],
        });
        return asJsonContent(response);
      },
    }));

    // --- notion_comment_list ---
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
        const notion = getClient(ctx.agentId);
        const response = await notion.comments.list({
          block_id: params.page_id,
        });
        return asJsonContent(response.results);
      },
    }));
  },
});
