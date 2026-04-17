/**
 * Cached Notion client factory.
 *
 * Maintains a per-agent client pool so repeated tool calls within the same
 * session reuse the same authenticated `Client` instance. Each agent resolves
 * to its own API key (see {@link getNotionApiKey}), preventing cross-workspace
 * leakage between agents.
 */

import { Client } from '@notionhq/client';
import { getNotionApiKey } from './auth.js';
import { NOTION_VERSION } from './constants.js';

/** One `Client` per agent, keyed by agentId (or "default"). */
const clients = new Map<string, Client>();

/**
 * Return a Notion SDK client for the given agent, creating one if needed.
 *
 * @param agentId - OpenClaw agent identifier. Defaults to `"default"`.
 * @returns A cached {@link Client} authenticated with the agent's API key.
 */
export function getClient(agentId?: string): Client {
  const cacheKey = agentId ?? 'default';
  const existingClient = clients.get(cacheKey);
  if (existingClient) {
    return existingClient;
  }

  const client = new Client({
    auth: getNotionApiKey(agentId),
    notionVersion: NOTION_VERSION,
  });
  clients.set(cacheKey, client);
  return client;
}
