/**
 * API key resolution and per-agent isolation tests.
 */

import { describe, expect, it } from 'vitest';
import { getNotionApiKey } from '../src/auth.js';

const SECONDARY_AGENT = process.env.NOTION_SECONDARY_AGENT ?? 'secondary';

describe('Key isolation', () => {
  it('default and secondary agents resolve to different API keys', () => {
    const defaultKey = getNotionApiKey(undefined);
    const secondaryKey = getNotionApiKey(SECONDARY_AGENT);
    expect(defaultKey).not.toBe(secondaryKey);
    expect(defaultKey.length).toBeGreaterThan(10);
    expect(secondaryKey.length).toBeGreaterThan(10);
  });

  it("explicitly passing 'main' falls back to the default key", () => {
    expect(getNotionApiKey('main')).toBe(getNotionApiKey(undefined));
  });

  it('unknown agentId falls back to default key', () => {
    expect(getNotionApiKey('nonexistent_agent_xyz')).toBe(getNotionApiKey(undefined));
  });

  it('API keys start with the Notion secret prefix', () => {
    const hasValidPrefix = (value: string) =>
      value.startsWith('ntn_') || value.startsWith('secret_');
    expect(hasValidPrefix(getNotionApiKey(undefined))).toBe(true);
    expect(hasValidPrefix(getNotionApiKey(SECONDARY_AGENT))).toBe(true);
  });

  it('repeated reads return the same default key', () => {
    expect(getNotionApiKey(undefined)).toBe(getNotionApiKey(undefined));
  });
});
