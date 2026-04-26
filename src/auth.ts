/**
 * Per-agent Notion API key resolution.
 *
 * Each OpenClaw agent can have its own Notion integration, isolated by
 * separate API keys stored in `~/.config/notion/`. The lookup order is:
 *
 * 1. `~/.config/notion/api_key_{agentId}` (agent-specific)
 * 2. `~/.config/notion/api_key_{NOTION_SECONDARY_AGENT}` (env-var override, 'secondary' alias only)
 * 3. `~/.config/notion/api_key` (default agent only)
 *
 * This guarantees workspace isolation: an explicit agent must have an
 * explicit key, so a missing `api_key_main` cannot silently reuse
 * another agent's default token.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function notionConfigDir(): string {
  return process.env.NOTION_CONFIG_DIR ?? path.join(os.homedir(), '.config', 'notion');
}

/**
 * Detect which explicit agent key files are available on disk.
 * Returns the first non-default key suffix, otherwise the generic "secondary" alias.
 */
function detectSecondaryAgentId(): string {
  const NOTION_CONFIG_DIR = notionConfigDir();
  try {
    const agentIds = fs
      .readdirSync(NOTION_CONFIG_DIR)
      .filter((entry) => entry.startsWith('api_key_'))
      .map((entry) => entry.replace(/^api_key_/, ''))
      .filter((agentId) => agentId && agentId !== 'default' && agentId !== 'main')
      .sort();
    if (agentIds[0]) {
      return agentIds[0];
    }
  } catch {
    // Missing config directories are handled by the caller's explicit error.
  }
  return 'secondary';
}

/**
 * Read the Notion API key for the given agent.
 *
 * @param agentId - OpenClaw agent identifier. Omit or pass `undefined` for
 *   the default workspace key. Use 'secondary' for the secondary agent
 *   (respects NOTION_SECONDARY_AGENT env var, falls back to disk detection).
 * @returns The trimmed API key string.
 * @throws {Error} When neither the agent-specific nor fallback key file exists.
 */
export function getNotionApiKey(agentId?: string): string {
  const NOTION_CONFIG_DIR = notionConfigDir();

  // Undefined always means the default key — NOTION_SECONDARY_AGENT does not apply.
  if (agentId === undefined || agentId === 'default') {
    const defaultKeyPath = path.join(NOTION_CONFIG_DIR, 'api_key');
    if (fs.existsSync(defaultKeyPath)) {
      return fs.readFileSync(defaultKeyPath, 'utf8').trim();
    }
    throw new Error(
      `Notion API key not found for the default agent. ` +
        `Expected at ${NOTION_CONFIG_DIR}/api_key.`
    );
  }

  // 'secondary' is a generic alias — apply env-var override + disk detection.
  if (agentId === 'secondary') {
    const envAgent = process.env.NOTION_SECONDARY_AGENT ?? detectSecondaryAgentId();
    const resolvedAgent = envAgent === 'secondary' ? detectSecondaryAgentId() : envAgent;
    const agentKeyPath = path.join(NOTION_CONFIG_DIR, `api_key_${resolvedAgent}`);
    if (fs.existsSync(agentKeyPath)) {
      return fs.readFileSync(agentKeyPath, 'utf8').trim();
    }
    throw new Error(
      `Notion API key not found for agent "${envAgent}". ` +
        `Expected at ${agentKeyPath}; explicit agents do not fall back to ${NOTION_CONFIG_DIR}/api_key.`
    );
  }

  // Explicit agent ID — require its specific key file and fail closed if absent.
  const agentKeyPath = path.join(NOTION_CONFIG_DIR, `api_key_${agentId}`);
  if (fs.existsSync(agentKeyPath)) {
    return fs.readFileSync(agentKeyPath, 'utf8').trim();
  }

  throw new Error(
    `Notion API key not found for agent "${agentId}". ` +
      `Expected at ${agentKeyPath}; explicit agents do not fall back to ${NOTION_CONFIG_DIR}/api_key.`
  );
}
