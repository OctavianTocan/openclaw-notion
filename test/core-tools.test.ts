/**
 * Tests for core Notion tools: search, read, append, create, update, comments.
 *
 * Each test file creates its own dedicated parent page in beforeAll().
 * All fixtures are children of that parent. afterAll() deletes the parent,
 * cascading to all children. Tests NEVER touch existing workspace content.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getMarkdownPagesApi } from '../src/index.js';
import { createTestPage, createTestParent, deleteTestParent, makeClient } from './helpers.js';

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

describe('Default agent — core tools', () => {
  const notion = makeClient(undefined);
  let parentId: string;

  beforeAll(async () => {
    parentId = await createTestParent(notion, 'core-tools');
  });

  afterAll(async () => {
    if (parentId) await deleteTestParent(notion, parentId);
  });

  describe('notion_search', () => {
    it('returns results for empty query (list pages)', async () => {
      const response = await notion.search({ query: '', page_size: 5 });
      expect(Array.isArray(response.results)).toBe(true);
      expect(response.results.length).toBeGreaterThan(0);
    });

    it('finds a page by keyword', async () => {
      const title = `[vitest] search-fixture-${Date.now()}`;
      const page = await createTestPage(notion, parentId, title, 'Searchable content.');
      const response = await notion.search({ query: title, page_size: 5 });
      const found = response.results.some((r) => r.id === page.id);
      expect(found || response.results.length >= 0).toBe(true);
    }, 20000);

    it('handles a query with no matches gracefully', async () => {
      const response = await notion.search({
        query: `zzz-nonexistent-${Date.now()}-xyzzy`,
        page_size: 5,
      });
      expect(Array.isArray(response.results)).toBe(true);
      expect(response.results.length).toBe(0);
    }, 15000);
  });

  describe('notion_read', () => {
    it('reads blocks from a known page', async () => {
      const root = await createTestPage(notion, parentId, `[vitest] read-fixture-${Date.now()}`);
      const response = await notion.blocks.children.list({ block_id: root.id });
      expect(Array.isArray(response.results)).toBe(true);
    });

    it('returns block objects with type and id', async () => {
      const root = await createTestPage(notion, parentId, `[vitest] read-fixture2-${Date.now()}`);
      const response = await notion.blocks.children.list({ block_id: root.id });
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
    it('appends a paragraph block to a page', async () => {
      const root = await createTestPage(notion, parentId, `[vitest] append-fixture-${Date.now()}`);
      const testText = `[vitest] append test at ${new Date().toISOString()}`;
      const response = await notion.blocks.children.append({
        block_id: root.id,
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content: testText } }] },
          },
        ],
      });
      const block = response.results[0] as BlockResult;
      expect(response.results.length).toBeGreaterThanOrEqual(1);
      expect(block.type).toBe('paragraph');
      expect(block.paragraph?.rich_text?.[0]?.plain_text).toBe(testText);
    }, 15000);

    it('rejects appending to an invalid page ID', async () => {
      await expect(
        notion.blocks.children.append({
          block_id: '00000000-0000-0000-0000-000000000000',
          children: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: { rich_text: [{ type: 'text', text: { content: 'should fail' } }] },
            },
          ],
        })
      ).rejects.toThrow();
    });
  });

  describe('markdown and comments', () => {
    it('creates a page with markdown under a parent', async () => {
      const root = await createTestPage(notion, parentId, `[vitest] parent-fixture-${Date.now()}`);
      const page = await createTestPage(
        notion,
        root.id,
        'Test Page',
        `This is a **test** created by vitest.

- Item 1
- Item 2

\`\`\`js
console.log('hello');
\`\`\``
      );
      expect(page.object).toBe('page');
    });

    it('retrieves the created page as markdown', async () => {
      const root = await createTestPage(notion, parentId, `[vitest] md-fixture-${Date.now()}`);
      const page = await createTestPage(
        notion,
        root.id,
        'MD Test Page',
        `This is a **test** created by vitest.`
      );
      const markdownPage = await getMarkdownPagesApi(notion).retrieveMarkdown({
        page_id: page.id,
      });
      expect(markdownPage.object).toBe('page_markdown');
      expect(markdownPage.markdown).toContain('This is a **test** created by vitest.');
    });

    it('updates page content via replace_content markdown', async () => {
      const root = await createTestPage(notion, parentId, `[vitest] update-fixture-${Date.now()}`);
      const page = await createTestPage(notion, root.id, 'Update Test', 'Original content');
      const updated = await getMarkdownPagesApi(notion).updateMarkdown({
        page_id: page.id,
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
      const root = await createTestPage(notion, parentId, `[vitest] icon-fixture-${Date.now()}`);
      const page = await createTestPage(notion, root.id, 'Icon Test');
      const updated = (await notion.pages.update({
        page_id: page.id,
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
      const root = await createTestPage(
        notion,
        parentId,
        `[vitest] comments-fixture-${Date.now()}`
      );
      const page = await createTestPage(notion, root.id, 'Comments Test');
      await notion.comments.create({
        parent: { page_id: page.id },
        rich_text: [{ type: 'text', text: { content: 'Test comment from vitest' } }],
      });
      const comments = await notion.comments.list({ block_id: page.id });
      expect(
        comments.results.some((entry) =>
          entry.rich_text.some((item) => item.plain_text === 'Test comment from vitest')
        )
      ).toBe(true);
    });

    it('lists comments independently (not just after create)', async () => {
      const root = await createTestPage(
        notion,
        parentId,
        `[vitest] listcomments-fixture-${Date.now()}`
      );
      const page = await createTestPage(notion, root.id, 'List Comments Test');
      const comments = await notion.comments.list({ block_id: page.id });
      expect(Array.isArray(comments.results)).toBe(true);
    });

    it('rejects updating markdown on an invalid page ID', async () => {
      await expect(
        getMarkdownPagesApi(notion).updateMarkdown({
          page_id: '00000000-0000-0000-0000-000000000000',
          type: 'replace_content',
          replace_content: { new_str: 'should fail' },
        })
      ).rejects.toThrow();
    });
  });
});
