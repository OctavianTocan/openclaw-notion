/**
 * Per-agent Notion API key resolution.
 *
 * Each OpenClaw agent can have its own Notion integration, isolated by
 * separate API keys stored in `~/.config/notion/`. The lookup order is:
 *
 * 1. `~/.config/notion/api_key_{agentId}` (agent-specific)
 * 2. `~/.config/notion/api_key_{NOTION_SECONDARY_AGENT}` (explicit override, 'secondary' only)
 * 3. `~/.config/notion/api_key` (shared fallback for explicit non-secondary agent IDs)
 *
 * This guarantees workspace isolation: each agent hits its own Notion
 * workspace and cannot access pages belonging to other agents.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

/**
 * Read the Notion API key for the given agent.
 *
 * @param agentId - OpenClaw agent identifier. Omit or pass `undefined` for
 *   the default workspace key. Use 'secondary' for the secondary agent
 *   (honors NOTION_SECONDARY_AGENT exactly when set, otherwise falls back to disk detection).
 * @returns The trimmed API key string.
 * @throws {Error} When the required key file does not exist.
 */
export function getNotionApiKey(agentId?: string): string {
  // Undefined always means the default key — NOTION_SECONDARY_AGENT does not apply.
  if (agentId === undefined) {
    const defaultKeyPath = path.join(NOTION_CONFIG_DIR, 'api_key');
    if (fs.existsSync(defaultKeyPath)) {
      return fs.readFileSync(defaultKeyPath, 'utf8').trim();
    }
    throw new Error(
      `Notion API key not found for the default agent. ` +
        `Expected at ${NOTION_CONFIG_DIR}/api_key.`
    );
  }

  // 'secondary' is a dedicated workspace — do not silently collapse onto the default key.
  if (agentId === 'secondary') {
    const resolvedAgent = process.env.NOTION_SECONDARY_AGENT ?? detectSecondaryAgentId();
    const agentKeyPath = path.join(NOTION_CONFIG_DIR, `api_key_${resolvedAgent}`);
    if (fs.existsSync(agentKeyPath)) {
      return fs.readFileSync(agentKeyPath, 'utf8').trim();
    }
    throw new Error(
      `Notion API key not found for secondary agent "${resolvedAgent}". ` +
        `Expected at ${agentKeyPath}.`
    );
  }

  // Explicit agent ID — look for its specific key file, then fall back to default.
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
