/**
 * Tests for notion_help, notion_doctor, URL surfacing, and cross-agent
 * workspace isolation on destructive operations.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deleteNotionPage,
  getNotionHelp,
  moveNotionPage,
  publishNotionPage,
  runNotionDoctor,
} from '../src/index.js';
import { makeClient } from './helpers.js';

const SECONDARY_AGENT = process.env.NOTION_SECONDARY_AGENT ?? 'secondary';

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
  let parentPageId: string;
  let testPageId: string;

  beforeAll(async () => {
    parentPageId = (await notion.search({ query: 'Deployment Plan', page_size: 1 })).results[0].id;
  });

  afterAll(async () => {
    if (testPageId) {
      await deleteNotionPage(notion, { page_id: testPageId }).catch(() => {});
    }
  });

  it('notion_create returns url at top level', async () => {
    const page = (await notion.pages.create({
      parent: { page_id: parentPageId },
      properties: {
        title: { title: [{ type: 'text', text: { content: '[vitest] url-test' } }] },
      },
      markdown: 'URL test page.',
    })) as UrlPage;
    testPageId = page.id;
    expect(page.url).toMatch(/^https:\/\/www\.notion\.so\//);
  }, 15000);

  it('notion_update_page returns url at top level', async () => {
    const page = (await notion.pages.update({
      page_id: testPageId,
      icon: { type: 'emoji', emoji: '🔗' },
    })) as UrlPage;
    expect(page.url).toMatch(/^https:\/\/www\.notion\.so\//);
  });
});

describe('Cross-agent workspace isolation (destructive ops)', () => {
  const secondaryNotion = makeClient(SECONDARY_AGENT);
  let defaultPageId: string;

  beforeAll(async () => {
    defaultPageId = (await makeClient(undefined).search({ query: 'Projects', page_size: 1 }))
      .results[0].id;
  });

  it('secondary agent cannot delete pages from the default workspace', async () => {
    await expect(deleteNotionPage(secondaryNotion, { page_id: defaultPageId })).rejects.toThrow();
  });

  it('secondary agent cannot move pages from the default workspace', async () => {
    await expect(
      moveNotionPage(secondaryNotion, {
        page_id: defaultPageId,
        new_parent_id: defaultPageId,
      })
    ).rejects.toThrow();
  });

  it('publish stub returns info for pages the secondary agent can access', async () => {
    const secondaryPageId = (await secondaryNotion.search({ query: '', page_size: 1 })).results[0]
      .id;
    const result = await publishNotionPage(secondaryNotion, { page_id: secondaryPageId });
    expect(result.supported).toBe(false);
    expect(result.page_id).toBe(secondaryPageId);
  });

  it('notion_doctor discovers both agents as configured', async () => {
    const agentIds = (await runNotionDoctor()).configured_agents.map((entry) => entry.agent_id);
    expect(agentIds).toContain('default');
    expect(agentIds).toContain(SECONDARY_AGENT);
  }, 20000);
});
