import { Client } from '@notionhq/client';
import { getNotionApiKey } from '../src/auth.js';
import { NOTION_VERSION } from '../src/constants.js';

export function makeClient(agentId?: string): Client {
  return new Client({
    auth: getNotionApiKey(agentId),
    notionVersion: NOTION_VERSION,
  });
}
