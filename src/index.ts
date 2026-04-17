import { Client } from '@notionhq/client';
import { getNotionApiKey } from './auth';

let notionClient: Client | null = null;

function getClient(): Client {
  if (!notionClient) {
    notionClient = new Client({ auth: getNotionApiKey() });
  }
  return notionClient;
}

export const tools = {
  notion_search: {
    description: 'Search the Notion workspace for pages or databases.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'The search query string.'
        }
      },
      required: ['query']
    },
    execute: async (args: { query: string }) => {
      const notion = getClient();
      const response = await notion.search({
        query: args.query,
        page_size: 10,
      });
      return JSON.stringify(response.results, null, 2);
    }
  },
  notion_read: {
    description: 'Read the contents of a Notion page.',
    parameters: {
      type: 'OBJECT',
      properties: {
        page_id: {
          type: 'STRING',
          description: 'The UUID of the Notion page to read.'
        }
      },
      required: ['page_id']
    },
    execute: async (args: { page_id: string }) => {
      const notion = getClient();
      // Fetching page blocks
      const response = await notion.blocks.children.list({
        block_id: args.page_id,
      });
      return JSON.stringify(response.results, null, 2);
    }
  },
  notion_append: {
    description: 'Append text blocks to a Notion page.',
    parameters: {
      type: 'OBJECT',
      properties: {
        page_id: {
          type: 'STRING',
          description: 'The UUID of the target Notion page.'
        },
        text: {
          type: 'STRING',
          description: 'The text content to append.'
        }
      },
      required: ['page_id', 'text']
    },
    execute: async (args: { page_id: string, text: string }) => {
      const notion = getClient();
      const response = await notion.blocks.children.append({
        block_id: args.page_id,
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [
                {
                  type: 'text',
                  text: {
                    content: args.text,
                  },
                },
              ],
            },
          },
        ],
      });
      return JSON.stringify(response.results, null, 2);
    }
  }
};
