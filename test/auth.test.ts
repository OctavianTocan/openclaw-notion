/**
 * API key resolution and per-agent isolation tests.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getNotionApiKey } from '../src/auth.js';

const SECONDARY_AGENT = 'secondary_agent';

describe('Key isolation', () => {
  const originalConfigDir = process.env.NOTION_CONFIG_DIR;
  const originalSecondaryAgent = process.env.NOTION_SECONDARY_AGENT;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-auth-'));
    process.env.NOTION_CONFIG_DIR = tempDir;
    process.env.NOTION_SECONDARY_AGENT = SECONDARY_AGENT;
    fs.writeFileSync(path.join(tempDir, 'api_key'), 'ntn_default_test_key');
    fs.writeFileSync(path.join(tempDir, `api_key_${SECONDARY_AGENT}`), 'ntn_secondary_test_key');
  });

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.NOTION_CONFIG_DIR;
    } else {
      process.env.NOTION_CONFIG_DIR = originalConfigDir;
    }
    if (originalSecondaryAgent === undefined) {
      delete process.env.NOTION_SECONDARY_AGENT;
    } else {
      process.env.NOTION_SECONDARY_AGENT = originalSecondaryAgent;
    }
  });

  it('default and secondary agents resolve to different API keys', () => {
    const defaultKey = getNotionApiKey(undefined);
    const secondaryKey = getNotionApiKey(SECONDARY_AGENT);
    expect(defaultKey).not.toBe(secondaryKey);
    expect(defaultKey.length).toBeGreaterThan(10);
    expect(secondaryKey.length).toBeGreaterThan(10);
  });

  it("explicitly passing 'default' resolves the default key", () => {
    expect(getNotionApiKey('default')).toBe(getNotionApiKey(undefined));
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

describe('Fail-closed key isolation', () => {
  const originalConfigDir = process.env.NOTION_CONFIG_DIR;
  const originalSecondaryAgent = process.env.NOTION_SECONDARY_AGENT;

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.NOTION_CONFIG_DIR;
    } else {
      process.env.NOTION_CONFIG_DIR = originalConfigDir;
    }
    if (originalSecondaryAgent === undefined) {
      delete process.env.NOTION_SECONDARY_AGENT;
    } else {
      process.env.NOTION_SECONDARY_AGENT = originalSecondaryAgent;
    }
  });

  it('does not let explicit agents fall back to the default key', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-auth-'));
    process.env.NOTION_CONFIG_DIR = tempDir;
    fs.writeFileSync(path.join(tempDir, 'api_key'), 'secret_default_key');

    expect(getNotionApiKey(undefined)).toBe('secret_default_key');
    expect(() => getNotionApiKey('main')).toThrow('explicit agents do not fall back');
    expect(() => getNotionApiKey('nonexistent_agent_xyz')).toThrow(
      'explicit agents do not fall back'
    );
  });

  it('does not let secondary fall back to the default key', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-auth-'));
    process.env.NOTION_CONFIG_DIR = tempDir;
    process.env.NOTION_SECONDARY_AGENT = SECONDARY_AGENT;
    fs.writeFileSync(path.join(tempDir, 'api_key'), 'secret_default_key');

    expect(() => getNotionApiKey('secondary')).toThrow('explicit agents do not fall back');
  });

  it('auto-detects a generic secondary key when no env override is set', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-auth-'));
    process.env.NOTION_CONFIG_DIR = tempDir;
    delete process.env.NOTION_SECONDARY_AGENT;
    fs.writeFileSync(path.join(tempDir, 'api_key'), 'secret_default_key');
    fs.writeFileSync(path.join(tempDir, 'api_key_other_agent'), 'secret_other_key');

    expect(getNotionApiKey('secondary')).toBe('secret_other_key');
  });
});
