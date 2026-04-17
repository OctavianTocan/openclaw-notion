import { Client } from '@notionhq/client';
import { getNotionApiKey } from './auth';

/**
 * Cached instance of the Notion SDK Client.
 * Prevents re-instantiating the client and re-reading the auth token on every tool call.
 */
let notionClient: Client | null = null;

/**
 * Initializes and retrieves the Notion SDK Client.
 * Automatically loads the authentication key from the local environment.
 * 
 * @returns {Client} An authenticated Notion Client instance.
 */
function getClient(): Client {
  if (!notionClient) {
    notionClient = new Client({ auth: getNotionApiKey() });
  }
  return notionClient;
}

/**
 * OpenClaw Tool Definitions
 * 
 * These definitions conform to the OpenClaw plugin specification. 
 * They map native agent tool calls directly to Notion API actions, 
 * bypassing the need for intermediate shell scripts or raw HTTP requests.
 */
export const tools = {
  
  /**
   * notion_search
   * 
   * Searches the entire connected Notion workspace.
   * Useful for finding page IDs needed for reading or appending.
   */
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
    execute: async (args: { query: string }) => {
      const notion = getClient();
      
      // Perform a search across the workspace, limiting to top 10 to avoid token bloat
      const response = await notion.search({
        query: args.query,
        page_size: 10,
      });
      
      return JSON.stringify(response.results, null, 2);
    }
  },

  /**
   * notion_read
   * 
   * Fetches the raw block contents of a specific page.
   * This is the designated replacement for attempting to use `web_fetch` on notion.so URLs.
   */
  notion_read: {
    description: 'Read the raw block contents of a Notion page using its UUID.',
    parameters: {
      type: 'OBJECT',
      properties: {
        page_id: {
          type: 'STRING',
          description: 'The UUID of the Notion page to read (can be extracted from the URL or search results).'
        }
      },
      required: ['page_id']
    },
    execute: async (args: { page_id: string }) => {
      const notion = getClient();
      
      // Fetch the immediate children blocks of the specified page
      const response = await notion.blocks.children.list({
        block_id: args.page_id,
      });
      
      return JSON.stringify(response.results, null, 2);
    }
  },

  /**
   * notion_append
   * 
   * Appends simple text as a new paragraph block at the bottom of a page.
   * Ideal for quick captures, inbox routing, or logging.
   */
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
    execute: async (args: { page_id: string, text: string }) => {
      const notion = getClient();
      
      // Append a single paragraph block containing the requested text
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
