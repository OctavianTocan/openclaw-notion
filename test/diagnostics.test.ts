/**
 * Tests for notion_help, notion_doctor, URL surfacing, and cross-agent
 * workspace isolation on destructive operations.
 *
 * Each test file creates its own dedicated parent page in beforeAll().
 * All fixtures are children of that parent. afterAll() deletes the parent,
 * cascading to all children. Tests NEVER touch existing workspace content.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteNotionPage, getNotionHelp, moveNotionPage, runNotionDoctor } from '../src/index.js';
import {
  createTestPage,
  createTestParent,
  deleteTestParent,
  makeClient,
  SECONDARY_AGENT,
} from './helpers.js';

type DoctorAgentReport = {
  agent_id: string;
  api_key_present: boolean;
  using_current_context?: boolean;
  connectivity: { ok: boolean };
};

type UrlPage = {
  id: string;
  url?: string;
};

describe('notion_help', () => {
  it('returns documentation for all tools', () => {
    const help = getNotionHelp();
    for (const toolName of [
      'notion_search',
      'notion_query',
      'notion_delete',
      'notion_move',
      'notion_publish',
      'notion_file_tree',
      'notion_sync',
      'notion_help',
      'notion_doctor',
    ]) {
      expect(help).toContain(toolName);
    }
  });

  it('returns help for a specific tool', () => {
    const help = getNotionHelp('notion_sync');
    expect(help).toContain('notion_sync');
    expect(help).not.toContain('notion_search');
  });

  it('throws for an unknown tool name', () => {
    expect(() => getNotionHelp('notion_foobar')).toThrow('Unknown Notion tool');
  });
});

describe('notion_doctor', () => {
  it('returns a diagnostic report with plugin info', async () => {
    const report = await runNotionDoctor();
    expect(report.plugin.name).toBe('openclaw-notion');
    expect(report.plugin.notion_version).toBe('2026-03-11');
    expect(report.plugin.sdk_version).toBeDefined();
    expect(report.plugin.version).toBeDefined();
  }, 20000);

  it('checks connectivity for all configured agents', async () => {
    const report = await runNotionDoctor();
    expect(report.configured_agents.length).toBeGreaterThanOrEqual(2);

    const defaultAgent = report.configured_agents.find(
      (entry): entry is DoctorAgentReport => entry.agent_id === 'default'
    );
    expect(defaultAgent?.api_key_present).toBe(true);
    expect(defaultAgent?.connectivity.ok).toBe(true);

    const secondaryAgent = report.configured_agents.find(
      (entry): entry is DoctorAgentReport => entry.agent_id === SECONDARY_AGENT
    );
    expect(secondaryAgent?.api_key_present).toBe(true);
    expect(secondaryAgent?.connectivity.ok).toBe(true);
  }, 20000);

  it('handles an agent context parameter', async () => {
    const report = await runNotionDoctor(SECONDARY_AGENT);
    expect(report.current_agent).toBe(SECONDARY_AGENT);
    expect(
      report.configured_agents.find(
        (entry): entry is DoctorAgentReport => entry.agent_id === SECONDARY_AGENT
      )?.using_current_context
    ).toBe(true);
  }, 20000);
});

describe('URL surfacing', () => {
  const notion = makeClient(undefined);
  let parentId: string;
  let testPageId: string;

  beforeAll(async () => {
    parentId = await createTestParent(notion, 'diagnostics-url');
  });

  afterAll(async () => {
    if (parentId) await deleteTestParent(notion, parentId);
  });

  it('notion_create returns url at top level', async () => {
    const page = (await createTestPage(notion, parentId, '[vitest] url-test')) as UrlPage;
    testPageId = page.id;
    expect(page.url).toMatch(/^https:\/\/www\.notion\.so\//);
  }, 15000);

  it('notion_update_page returns url at top level', async () => {
    if (!testPageId) throw new Error('testPageId not set');
    const page = (await notion.pages.update({
      page_id: testPageId,
      icon: { type: 'emoji', emoji: '🔗' },
    })) as UrlPage;
    expect(page.url).toMatch(/^https:\/\/www\.notion\.so\//);
  });
});

describe('Cross-agent workspace isolation (destructive ops)', () => {
  const defaultNotion = makeClient(undefined);
  const secondaryNotion = makeClient(SECONDARY_AGENT);
  let defaultParentId: string;
  let secondaryParentId: string;

  beforeAll(async () => {
    defaultParentId = await createTestParent(defaultNotion, 'diagnostics-default-isolate');
    secondaryParentId = await createTestParent(secondaryNotion, 'diagnostics-secondary-isolate');
  });

  afterAll(async () => {
    if (defaultParentId) await deleteTestParent(defaultNotion, defaultParentId);
    if (secondaryParentId) await deleteTestParent(secondaryNotion, secondaryParentId);
  });

  it('secondary agent cannot delete pages from the default workspace', async () => {
    // Create a page in the default workspace
    const defaultPage = await createTestPage(
      defaultNotion,
      defaultParentId,
      '[vitest] default-isolated-page'
    );
    // Secondary agent must NOT be able to delete it
    await expect(deleteNotionPage(secondaryNotion, { page_id: defaultPage.id })).rejects.toThrow();
  });

  it('secondary agent cannot move pages from the default workspace', async () => {
    const defaultPage = await createTestPage(
      defaultNotion,
      defaultParentId,
      '[vitest] default-move-test'
    );
    // Secondary agent must NOT be able to move it
    await expect(
      moveNotionPage(secondaryNotion, {
        page_id: defaultPage.id,
        new_parent_id: defaultParentId,
      })
    ).rejects.toThrow();
  });

  it('secondary agent can manage its own workspace independently', async () => {
    // Create a page in the secondary workspace and delete it — should succeed
    const secondaryPage = await createTestPage(
      secondaryNotion,
      secondaryParentId,
      '[vitest] secondary-own-page'
    );
    await expect(
      deleteNotionPage(secondaryNotion, { page_id: secondaryPage.id })
    ).resolves.toBeDefined();
  });

  it('notion_doctor discovers both agents as configured', async () => {
    const agentIds = (await runNotionDoctor()).configured_agents.map((entry) => entry.agent_id);
    expect(agentIds).toContain('default');
    expect(agentIds).toContain(SECONDARY_AGENT);
  }, 20000);
});
