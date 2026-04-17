import fs from 'fs';
import path from 'path';
import os from 'os';

export function getNotionApiKey(): string {
  const keyPath = path.join(os.homedir(), '.config', 'notion', 'api_key');
  try {
    return fs.readFileSync(keyPath, 'utf8').trim();
  } catch (error: any) {
    throw new Error(`Failed to read Notion API key from ${keyPath}: ${error.message}`);
  }
}
