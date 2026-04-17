import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Retrieves the Notion API key from the local filesystem.
 * 
 * OpenClaw environments typically store API keys in the user's home directory.
 * This utility reads the file at `~/.config/notion/api_key` synchronously.
 * 
 * @returns {string} The trimmed Notion API key.
 * @throws {Error} If the file does not exist, lacks read permissions, or is empty.
 */
export function getNotionApiKey(): string {
  // Resolve the absolute path to the configuration file
  const keyPath = path.join(os.homedir(), '.config', 'notion', 'api_key');
  
  try {
    // Read and trim to ensure no trailing newlines cause authentication failures
    return fs.readFileSync(keyPath, 'utf8').trim();
  } catch (error: any) {
    throw new Error(`Failed to read Notion API key from ${keyPath}: ${error.message}`);
  }
}
