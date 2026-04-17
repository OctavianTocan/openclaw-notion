import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteNotionPage } from '../src/index.js';
import { makeClient } from './helpers.js';

type SearchResultPage = {
  id: string;
  object?: string;
  url?: string;
  properties?: {
    title?: { title?: Array<{ plain_text?: string }> };
  };
};

type BlockResult = {
  id?: string;
  object?: string;
  type?: string;
  paragraph?: { rich_text?: Array<{ plain_text?: string }> };
};

type UpdatedPage = {
  id: string;
  object?: string;
  icon?: { emoji?: string };
  properties?: {
    title?: { title?: Array<{ plain_text?: string }> };
  };
};

function requirePageId(pageId: string | undefined): string {
  if (!pageId) {
    throw new Error('Expected page ID to be defined');
  }
  return pageId;
}

describe('Default agent (Wretch / Tavi)', () => {
  const notion = makeClient(undefined);
  let testPageId: string;
  let deploymentPlanId: string;

  describe('notion_search', () => {
    it('returns results for empty query (list pages)', async () => {
      const response = await notion.search({ query: '', page_size: 5 });
      expect(Array.isArray(response.results)).toBe(true);
      expect(response.results.length).toBeGreaterThan(0);
    });

    it("finds 'Projects' by keyword", async () => {
      const response = await notion.search({ query: 'Projects', page_size: 5 });
      const page = response.results[0] as SearchResultPage;
      expect(response.results.length).toBeGreaterThan(0);
      expect(page.id).toBeDefined();
      expect(page.object).toBe('page');
    });

    it('returns page properties including title', async () => {
      const response = await notion.search({ query: 'Projects', page_size: 1 });
      const page = response.results[0] as SearchResultPage;
      expect(page.properties).toBeDefined();
      expect(page.properties?.title).toBeDefined();
      expect(page.properties?.title?.title?.[0]?.plain_text?.length).toBeGreaterThan(0);
    });

    it('returns URL for found pages', async () => {
      const response = await notion.search({ query: 'Projects', page_size: 1 });
      expect((response.results[0] as SearchResultPage).url).toMatch(/^https:\/\/www\.notion\.so\//);
    });

    it('handles a query with no matches gracefully', async () => {
      const response = await notion.search({
        query: 'zzz_nonexistent_page_12345_xyzzy',
        page_size: 5,
      });
      expect(Array.isArray(response.results)).toBe(true);
    }, 15000);
  });

  describe('notion_read', () => {
    beforeAll(async () => {
      testPageId = (await notion.search({ query: 'Projects', page_size: 1 })).results[0].id;
    });

    it('reads blocks from a known page', async () => {
      expect(
        Array.isArray((await notion.blocks.children.list({ block_id: testPageId })).results)
      ).toBe(true);
    });

    it('returns block objects with type and id', async () => {
      const response = await notion.blocks.children.list({ block_id: testPageId });
      if (response.results.length > 0) {
        const block = response.results[0] as BlockResult;
        expect(block.id).toBeDefined();
        expect(block.type).toBeDefined();
        expect(block.object).toBe('block');
      }
    });

    it('rejects invalid page ID with an error', async () => {
      await expect(
        notion.blocks.children.list({ block_id: '00000000-0000-0000-0000-000000000000' })
      ).rejects.toThrow();
    });
  });

  describe('notion_append', () => {
    let appendTargetId: string;

    beforeAll(async () => {
      appendTargetId = (await notion.search({ query: 'Deployment Plan', page_size: 1 })).results[0]
        .id;
    });

    it('appends a paragraph block to a page', async () => {
      const testText = `[vitest] append test at ${new Date().toISOString()}`;
      const response = await notion.blocks.children.append({
        block_id: appendTargetId,
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content: testText } }] },
          },
        ],
      });
      const block = response.results[0] as BlockResult;
      expect(response.results.length).toBe(1);
      expect(block.type).toBe('paragraph');
      expect(block.paragraph?.rich_text?.[0]?.plain_text).toBe(testText);
    }, 15000);
  });

  describe('markdown and comments', () => {
    let newPageId: string | undefined;

    beforeAll(async () => {
      deploymentPlanId = (await notion.search({ query: 'Deployment Plan', page_size: 1 }))
        .results[0].id;
    }, 20000);

    afterAll(async () => {
      if (newPageId) {
        await deleteNotionPage(notion, { page_id: newPageId }).catch(() => {});
      }
    });

    it('creates a page with markdown under Deployment Plan', async () => {
      const page = await notion.pages.create({
        parent: { page_id: deploymentPlanId },
        properties: {
          title: { title: [{ type: 'text', text: { content: 'Test Page' } }] },
        },
        markdown: `This is a **test** created by vitest.

- Item 1
- Item 2

\`\`\`js
console.log('hello');
\`\`\``,
      });
      newPageId = page.id;
      expect(page.object).toBe('page');
    });

    it('retrieves the created page as markdown', async () => {
      const markdownPage = await notion.pages.retrieveMarkdown({
        page_id: requirePageId(newPageId),
      });
      expect(markdownPage.object).toBe('page_markdown');
      expect(markdownPage.markdown).toContain('This is a **test** created by vitest.');
    });

    it('updates page content via replace_content markdown', async () => {
      const updated = await notion.pages.updateMarkdown({
        page_id: requirePageId(newPageId),
        type: 'replace_content',
        replace_content: {
          new_str: `# Updated Title

New content here.`,
        },
      });
      expect(updated.markdown).toContain('Updated Title');
      expect(updated.markdown).toContain('New content here.');
    });

    it('updates page title and icon', async () => {
      const updated = (await notion.pages.update({
        page_id: requirePageId(newPageId),
        icon: { type: 'emoji', emoji: '🧪' },
        properties: {
          title: {
            title: [{ type: 'text', text: { content: 'Renamed Test Page' } }],
          },
        },
      })) as UpdatedPage;
      expect(updated.icon?.emoji).toBe('🧪');
      expect(updated.properties?.title?.title?.[0]?.plain_text).toBe('Renamed Test Page');
    });

    it('creates and lists comments for the test page', async () => {
      await notion.comments.create({
        parent: { page_id: requirePageId(newPageId) },
        rich_text: [{ type: 'text', text: { content: 'Test comment from vitest' } }],
      });
      const comments = await notion.comments.list({ block_id: requirePageId(newPageId) });
      expect(
        comments.results.some((entry) =>
          entry.rich_text.some((item) => item.plain_text === 'Test comment from vitest')
        )
      ).toBe(true);
    });
  });
});
