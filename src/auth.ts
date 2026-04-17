import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Retrieves the Notion API key from the local filesystem based on the agent context.
 *
 * It first attempts to load an agent-specific key (e.g., `~/.config/notion/api_key_gf_agent`).
 * If not found or no agentId is provided, it falls back to the default `~/.config/notion/api_key`.
 *
 * @param {string} [agentId] The ID of the OpenClaw agent executing the tool.
 * @returns {string} The trimmed Notion API key.
 * @throws {Error} If the key file cannot be read.
 */
export function getNotionApiKey(agentId?: string): string {
  const configDir = path.join(os.homedir(), ".config", "notion");

  if (agentId) {
    const agentKeyPath = path.join(configDir, `api_key_${agentId}`);
    try {
      if (fs.existsSync(agentKeyPath)) {
        return fs.readFileSync(agentKeyPath, "utf8").trim();
      }
    } catch {
      // Ignore read errors for the agent-specific key and fall back
    }
  }

  const defaultKeyPath = path.join(configDir, "api_key");
  try {
    return fs.readFileSync(defaultKeyPath, "utf8").trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read Notion API key from ${defaultKeyPath}: ${message}`);
  }
}
