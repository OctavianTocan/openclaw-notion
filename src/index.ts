import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { Client } from "@notionhq/client";
import { getNotionApiKey } from "./auth.js";

const clients = new Map<string, Client>();

function getClient(agentId?: string): Client {
  const cacheKey = agentId || 'default';
  if (!clients.has(cacheKey)) {
    clients.set(cacheKey, new Client({ auth: getNotionApiKey(agentId) }));
  }
  return clients.get(cacheKey)!;
}

export default definePluginEntry({
  id: "notion",
  name: "Notion",
  description: "Notion API for creating and managing pages, databases, and blocks.",
  register(api) {
    api.registerTool({
      name: "notion_search",
      label: "Notion Search",
      description: "Search the Notion workspace for pages or databases. Returns matching items with their IDs.",
      parameters: Type.Object({
        query: Type.String({ description: "The text to search for across page titles and contents." })
      }),
      async execute(_id, params) {
        const notion = getClient('default');
        const response = await notion.search({
          query: params.query,
          page_size: 10,
        });
        return { content: [{ type: "text", text: JSON.stringify(response.results, null, 2) }], details: null };
      }
    });

    api.registerTool({
      name: "notion_read",
      label: "Notion Read",
      description: "Read the raw block contents of a Notion page using its UUID.",
      parameters: Type.Object({
        page_id: Type.String({ description: "The UUID of the Notion page to read." })
      }),
      async execute(_id, params) {
        const notion = getClient('default');
        const response = await notion.blocks.children.list({
          block_id: params.page_id,
        });
        return { content: [{ type: "text", text: JSON.stringify(response.results, null, 2) }], details: null };
      }
    });

    api.registerTool({
      name: "notion_append",
      label: "Notion Append",
      description: "Append a simple text paragraph block to the bottom of a Notion page.",
      parameters: Type.Object({
        page_id: Type.String({ description: "The UUID of the target Notion page." }),
        text: Type.String({ description: "The plain text content to append." })
      }),
      async execute(_id, params) {
        const notion = getClient('default');
        const response = await notion.blocks.children.append({
          block_id: params.page_id,
          children: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [
                  {
                    type: 'text',
                    text: { content: params.text },
                  },
                ],
              },
            },
          ],
        });
        return { content: [{ type: "text", text: JSON.stringify(response.results, null, 2) }], details: null };
      }
    });
  }
});
