/**
 * Per-agent Notion API key resolution.
 *
 * Each OpenClaw agent can have its own Notion integration, isolated by
 * separate API keys stored in `~/.config/notion/`. The lookup order is:
 *
 * 1. `~/.config/notion/api_key_{agentId}` (agent-specific)
 * 2. `~/.config/notion/api_key` (shared fallback)
 *
 * This guarantees workspace isolation: Alaric (gf_agent) hits Esther's
 * workspace while Wretch (main / default) hits Tavi's.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Read the Notion API key for the given agent.
 *
 * @param agentId - OpenClaw agent identifier. Omit or pass `undefined` for
 *   the default workspace key.
 * @returns The trimmed API key string.
 * @throws {Error} When neither the agent-specific nor fallback key file exists.
 */
export function getNotionApiKey(agentId?: string): string {
  const configDir = path.join(os.homedir(), '.config', 'notion');

  if (agentId) {
    const agentKeyPath = path.join(configDir, `api_key_${agentId}`);
    if (fs.existsSync(agentKeyPath)) {
      return fs.readFileSync(agentKeyPath, 'utf8').trim();
    }
  }

  const defaultKeyPath = path.join(configDir, 'api_key');
  if (fs.existsSync(defaultKeyPath)) {
    return fs.readFileSync(defaultKeyPath, 'utf8').trim();
  }

  throw new Error(
    `Notion API key not found for agent "${agentId ?? 'default'}". ` +
      `Expected at ${configDir}/api_key or ${configDir}/api_key_${agentId ?? 'default'}.`
  );
}
