/**
 * Multi-agent workspace isolation tests.
 *
 * Verifies that a secondary agent authenticates to a separate Notion
 * workspace and cannot see pages belonging to the default agent.
 *
 * Set `NOTION_SECONDARY_AGENT` to the agent ID whose key lives at
 * `~/.config/notion/api_key_{id}`. Defaults to `"secondary"`.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { makeClient } from './helpers.js';

const SECONDARY_AGENT = process.env.NOTION_SECONDARY_AGENT ?? 'secondary';

type SearchResultEntry = {
  id: string;
  properties?: {
    title?: { title?: Array<{ plain_text?: string }> };
    Name?: { title?: Array<{ plain_text?: string }> };
  };
};

type ParagraphBlock = {
  paragraph?: { rich_text?: Array<{ plain_text?: string }> };
};

describe(`Secondary agent (${SECONDARY_AGENT})`, () => {
  const notion = makeClient(SECONDARY_AGENT);
  let testPageId: string;

  describe('notion_search', () => {
    it('authenticates and returns results from the secondary workspace', async () => {
      const response = await notion.search({ query: '', page_size: 5 });
      expect(Array.isArray(response.results)).toBe(true);
      expect(response.results.length).toBeGreaterThan(0);
    });

    it('finds content specific to the secondary workspace', async () => {
      const response = await notion.search({ query: 'Possessives', page_size: 5 });
      expect(response.results.length).toBeGreaterThan(0);
      expect(response.results[0].id).toBeDefined();
    }, 15000);

    it('does NOT return content from the default workspace', async () => {
      const response = await notion.search({ query: '01 — Projects', page_size: 5 });
      const titles = response.results.map((entry) => {
        const page = entry as SearchResultEntry;
        const titleProp = page.properties?.title || page.properties?.Name;
        return titleProp?.title?.[0]?.plain_text || '';
      });
      expect(titles).not.toContain('01 — Projects');
    });
  });

  describe('notion_read', () => {
    beforeAll(async () => {
      const results = (await notion.search({ query: '', page_size: 1 })).results;
      expect(results.length).toBeGreaterThan(0);
      testPageId = results[0].id;
    });

    it('reads blocks from the secondary workspace', async () => {
      expect(
        Array.isArray((await notion.blocks.children.list({ block_id: testPageId })).results)
      ).toBe(true);
    });

    it('cannot read pages from the default workspace', async () => {
      await expect(
        notion.blocks.children.list({ block_id: 'dcc09ec2-11b3-4a95-8118-daede10eef1d' })
      ).rejects.toThrow();
    });

    it('can read pages as markdown in the secondary workspace', async () => {
      const pageId = (await notion.search({ query: '', page_size: 1 })).results[0].id;
      const markdown = await notion.pages.retrieveMarkdown({ page_id: pageId });
      expect(markdown.object).toBe('page_markdown');
      expect(markdown.markdown.length).toBeGreaterThan(0);
    });

    it('cannot read default workspace pages as markdown', async () => {
      await expect(
        notion.pages.retrieveMarkdown({ page_id: 'dcc09ec2-11b3-4a95-8118-daede10eef1d' })
      ).rejects.toThrow();
    });
  });

  describe('notion_append', () => {
    it('can append to a page in the secondary workspace', async () => {
      const pageId = (await notion.search({ query: '', page_size: 1 })).results[0].id;
      const testText = `[vitest ${SECONDARY_AGENT}] append test at ${new Date().toISOString()}`;
      const response = await notion.blocks.children.append({
        block_id: pageId,
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content: testText } }] },
          },
        ],
      });
      expect(response.results.length).toBe(1);
      expect((response.results[0] as ParagraphBlock).paragraph?.rich_text?.[0]?.plain_text).toBe(
        testText
      );
    });
  });
});

describe('Cross-workspace isolation', () => {
  it('default and secondary agents return completely different page sets', async () => {
    const [defaultResults, secondaryResults] = await Promise.all([
      makeClient(undefined).search({ query: '', page_size: 5 }),
      makeClient(SECONDARY_AGENT).search({ query: '', page_size: 5 }),
    ]);
    const defaultIds = new Set(defaultResults.results.map((entry) => entry.id));
    const secondaryIds = new Set(secondaryResults.results.map((entry) => entry.id));
    expect([...defaultIds].filter((id) => secondaryIds.has(id)).length).toBe(0);
  });
});
