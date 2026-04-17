import { Client } from "@notionhq/client";
import { getNotionApiKey } from "./auth.js";
import { NOTION_VERSION } from "./constants.js";

const clients = new Map<string, Client>();

export function getClient(agentId?: string): Client {
  const cacheKey = agentId ?? "default";
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
