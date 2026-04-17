import { Client } from '@notionhq/client';
import { getNotionApiKey } from './auth';

/**
 * Cached instances of the Notion SDK Client, keyed by agentId (or 'default').
 * Prevents re-instantiating the client on every tool call.
 */
const clients = new Map<string, Client>();

/**
 * Initializes and retrieves the Notion SDK Client for a given agent.
 * Automatically loads the authentication key, prioritizing agent-specific keys.
 * 
 * @param {string} [agentId] The OpenClaw agent ID.
 * @returns {Client} An authenticated Notion Client instance.
 */
function getClient(agentId?: string): Client {
  const cacheKey = agentId || 'default';
  if (!clients.has(cacheKey)) {
    clients.set(cacheKey, new Client({ auth: getNotionApiKey(agentId) }));
  }
  return clients.get(cacheKey)!;
}

export const tools = {
  notion_search: {
    description: 'Search the Notion workspace for pages or databases. Returns matching items with their IDs.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'The text to search for across page titles and contents.'
        }
      },
      required: ['query']
    },
    execute: async (args: { query: string }, context?: any) => {
      const notion = getClient(context?.agentId);
      const response = await notion.search({
        query: args.query,
        page_size: 10,
      });
      return JSON.stringify(response.results, null, 2);
    }
  },

  notion_read: {
    description: 'Read the raw block contents of a Notion page using its UUID.',
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
    execute: async (args: { page_id: string }, context?: any) => {
      const notion = getClient(context?.agentId);
      const response = await notion.blocks.children.list({
        block_id: args.page_id,
      });
      return JSON.stringify(response.results, null, 2);
    }
  },

  notion_append: {
    description: 'Append a simple text paragraph block to the bottom of a Notion page.',
    parameters: {
      type: 'OBJECT',
      properties: {
        page_id: {
          type: 'STRING',
          description: 'The UUID of the target Notion page.'
        },
        text: {
          type: 'STRING',
          description: 'The plain text content to append.'
        }
      },
      required: ['page_id', 'text']
    },
    execute: async (args: { page_id: string, text: string }, context?: any) => {
      const notion = getClient(context?.agentId);
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
