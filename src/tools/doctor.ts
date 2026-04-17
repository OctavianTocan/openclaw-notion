import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getNotionApiKey } from "../auth.js";
import { getClient } from "../client.js";
import { KNOWN_AGENT_IDS, NOTION_VERSION } from "../constants.js";
import { getPackageMetadata } from "../helpers.js";

export function listConfiguredAgents() {
  const configDir = path.join(os.homedir(), ".config", "notion");
  const discovered = new Set<string>(KNOWN_AGENT_IDS);
  try {
    for (const entry of fs.readdirSync(configDir)) {
      if (entry === "api_key") {
        discovered.add("default");
      } else if (entry.startsWith("api_key_")) {
        discovered.add(entry.replace(/^api_key_/, ""));
      }
    }
  } catch {
    discovered.add("default");
  }
  return [...discovered];
}

export async function runNotionDoctor(currentAgentId?: string) {
  const { pluginName, pluginVersion, sdkVersion } = getPackageMetadata();
  const configuredAgents = await Promise.all(
    listConfiguredAgents().map(async (agentId) => {
      const resolvedAgentId = agentId === "default" ? undefined : agentId;
      try {
        const apiKey = getNotionApiKey(resolvedAgentId);
        const notion = getClient(resolvedAgentId);
        const response = await notion.search({ query: "", page_size: 1 });
        return {
          agent_id: agentId,
          using_current_context: (currentAgentId ?? "default") === agentId,
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
          using_current_context: (currentAgentId ?? "default") === agentId,
          api_key_present: false,
          connectivity: {
            ok: false,
            error: message,
          },
        };
      }
    }),
  );

  return {
    plugin: {
      name: pluginName,
      version: pluginVersion,
      notion_version: NOTION_VERSION,
      sdk_version: sdkVersion,
    },
    current_agent: currentAgentId ?? "default",
    configured_agents: configuredAgents,
  };
}
