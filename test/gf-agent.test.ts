import { beforeAll, describe, expect, it } from 'vitest';
import { makeClient } from './helpers.js';

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

describe('gf_agent (Alaric / Esther)', () => {
  const notion = makeClient('gf_agent');
  let testPageId: string;

  describe('notion_search', () => {
    it("authenticates and returns results from Esther's workspace", async () => {
      const response = await notion.search({ query: '', page_size: 5 });
      expect(Array.isArray(response.results)).toBe(true);
      expect(response.results.length).toBeGreaterThan(0);
    });

    it('finds Esther-specific content', async () => {
      const response = await notion.search({ query: 'Possessives', page_size: 5 });
      expect(response.results.length).toBeGreaterThan(0);
      expect(response.results[0].id).toBeDefined();
    }, 15000);

    it('does NOT return Tavi-specific content', async () => {
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
      testPageId = (await notion.search({ query: '', page_size: 1 })).results[0].id;
    });

    it("reads blocks from Esther's workspace", async () => {
      expect(
        Array.isArray((await notion.blocks.children.list({ block_id: testPageId })).results)
      ).toBe(true);
    });

    it("cannot read Tavi's pages with gf_agent key", async () => {
      await expect(
        notion.blocks.children.list({ block_id: 'dcc09ec2-11b3-4a95-8118-daede10eef1d' })
      ).rejects.toThrow();
    });

    it("can read one of Esther's pages as markdown", async () => {
      const pageId = (await notion.search({ query: '', page_size: 1 })).results[0].id;
      const markdown = await notion.pages.retrieveMarkdown({ page_id: pageId });
      expect(markdown.object).toBe('page_markdown');
      expect(markdown.markdown.length).toBeGreaterThan(0);
    });

    it("cannot read Tavi's pages as markdown with gf_agent key", async () => {
      await expect(
        notion.pages.retrieveMarkdown({ page_id: 'dcc09ec2-11b3-4a95-8118-daede10eef1d' })
      ).rejects.toThrow();
    });
  });

  describe('notion_append', () => {
    it("can append to a page in Esther's workspace", async () => {
      const pageId = (await notion.search({ query: '', page_size: 1 })).results[0].id;
      const testText = `[vitest gf_agent] append test at ${new Date().toISOString()}`;
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
  it('default search and gf_agent search return different page sets', async () => {
    const [defaultResults, gfResults] = await Promise.all([
      makeClient(undefined).search({ query: '', page_size: 5 }),
      makeClient('gf_agent').search({ query: '', page_size: 5 }),
    ]);
    const defaultIds = new Set(defaultResults.results.map((entry) => entry.id));
    const gfIds = new Set(gfResults.results.map((entry) => entry.id));
    expect([...defaultIds].filter((id) => gfIds.has(id)).length).toBe(0);
  });
});
