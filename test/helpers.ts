import { Client } from '@notionhq/client';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NOTION_VERSION } from '../src/constants.js';

/**
 * Per-agent Notion API key resolution.
 *
 * Each OpenClaw agent can have its own Notion integration, isolated by
 * separate API keys stored in `~/.config/notion/`. The lookup order is:
 *
 * 1. `~/.config/notion/api_key_{agentId}` (agent-specific)
 * 2. `~/.config/notion/api_key_{NOTION_SECONDARY_AGENT}` (env-var override)
 * 3. `~/.config/notion/api_key` (shared fallback)
 *
 * This guarantees workspace isolation: each agent hits its own Notion
 * workspace and cannot access pages belonging to other agents.
 */

const NOTION_CONFIG_DIR = path.join(os.homedir(), '.config', 'notion');

/**
 * Detect which agent key files are available on disk.
 * Returns 'gf_agent' if api_key_gf_agent exists (local dev), otherwise 'secondary' (CI default).
 */
function detectSecondaryAgentId(): string {
  const secondaryKeyPath = path.join(NOTION_CONFIG_DIR, 'api_key_gf_agent');
  if (fs.existsSync(secondaryKeyPath)) {
    return 'gf_agent';
  }
  return 'secondary';
}

export function getNotionApiKey(agentId?: string): string {
  if (agentId === 'secondary' || agentId === undefined) {
    // Apply env-var override, falling back to disk detection then 'secondary'
    const envAgent = process.env.NOTION_SECONDARY_AGENT ?? detectSecondaryAgentId();
    const resolvedAgent = envAgent === 'secondary' ? detectSecondaryAgentId() : envAgent;
    const agentKeyPath = path.join(NOTION_CONFIG_DIR, `api_key_${resolvedAgent}`);
    if (fs.existsSync(agentKeyPath)) {
      return fs.readFileSync(agentKeyPath, 'utf8').trim();
    }
    if (agentId === 'secondary') {
      // Only fall back to default key when explicitly asked for 'secondary'
      const defaultKeyPath = path.join(NOTION_CONFIG_DIR, 'api_key');
      if (fs.existsSync(defaultKeyPath)) {
        return fs.readFileSync(defaultKeyPath, 'utf8').trim();
      }
    }
    throw new Error(
      `Notion API key not found for agent "${envAgent}". ` +
        `Expected at ${agentKeyPath} or ${NOTION_CONFIG_DIR}/api_key.`
    );
  }

  const agentKeyPath = path.join(NOTION_CONFIG_DIR, `api_key_${agentId}`);
  if (fs.existsSync(agentKeyPath)) {
    return fs.readFileSync(agentKeyPath, 'utf8').trim();
  }

  const defaultKeyPath = path.join(NOTION_CONFIG_DIR, 'api_key');
  if (fs.existsSync(defaultKeyPath)) {
    return fs.readFileSync(defaultKeyPath, 'utf8').trim();
  }

  throw new Error(
    `Notion API key not found for agent "${agentId}". ` +
      `Expected at ${agentKeyPath} or ${NOTION_CONFIG_DIR}/api_key.`
  );
}

export function makeClient(agentId?: string): Client {
  return new Client({
    auth: getNotionApiKey(agentId),
    notionVersion: NOTION_VERSION,
  });
}
