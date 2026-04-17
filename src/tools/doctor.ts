/**
 * Plugin diagnostics tool.
 *
 * Scans `~/.config/notion/` for configured agent keys, tests connectivity
 * for each one, and reports SDK/plugin versions. Useful for verifying that
 * multi-agent workspace isolation is correctly wired.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getNotionApiKey } from '../auth.js';
import { getClient } from '../client.js';
import { KNOWN_AGENT_IDS, NOTION_VERSION } from '../constants.js';
import { getPackageMetadata } from '../helpers.js';

/**
 * Discover all agent IDs that have Notion API keys on disk.
 *
 * Starts with the hard-coded {@link KNOWN_AGENT_IDS} and adds any extra
 * agents found by scanning `~/.config/notion/api_key_*` files.
 *
 * @returns Deduplicated array of agent ID strings.
 */
export function listConfiguredAgents() {
  const configDir = path.join(os.homedir(), '.config', 'notion');
  const discovered = new Set<string>(KNOWN_AGENT_IDS);
  try {
    for (const entry of fs.readdirSync(configDir)) {
      if (entry === 'api_key') {
        discovered.add('default');
      } else if (entry.startsWith('api_key_')) {
        discovered.add(entry.replace(/^api_key_/, ''));
      }
    }
  } catch {
    discovered.add('default');
  }
  return [...discovered];
}

/**
 * Run read-only diagnostics across all configured Notion agents.
 *
 * For each agent: resolves the API key, creates a client, and fires a
 * minimal search request to verify connectivity.
 *
 * @param currentAgentId - The active agent's ID (used to flag which
 *   entry in the report matches the caller's context).
 * @returns Structured diagnostic report with plugin info and per-agent status.
 */
export async function runNotionDoctor(currentAgentId?: string) {
  const { pluginName, pluginVersion, sdkVersion } = getPackageMetadata();
  const configuredAgents = await Promise.all(
    listConfiguredAgents().map(async (agentId) => {
      const resolvedAgentId = agentId === 'default' ? undefined : agentId;
      try {
        const apiKey = getNotionApiKey(resolvedAgentId);
        const notion = getClient(resolvedAgentId);
        const response = await notion.search({ query: '', page_size: 1 });
        return {
          agent_id: agentId,
          using_current_context: (currentAgentId ?? 'default') === agentId,
          api_key_present: true,
          api_key_prefix: apiKey.slice(0, 6),
          connectivity: {
            ok: true,
            result_count: response.results.length,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          agent_id: agentId,
          using_current_context: (currentAgentId ?? 'default') === agentId,
          api_key_present: false,
          connectivity: {
            ok: false,
            error: message,
          },
        };
      }
    })
  );

  return {
    plugin: {
      name: pluginName,
      version: pluginVersion,
      notion_version: NOTION_VERSION,
      sdk_version: sdkVersion,
    },
    current_agent: currentAgentId ?? 'default',
    configured_agents: configuredAgents,
  };
}
