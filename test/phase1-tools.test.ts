import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deleteNotionPage,
  getNotionFileTree,
  moveNotionPage,
  publishNotionPage,
} from '../src/index.js';
import { makeClient } from './helpers.js';

type MinimalPage = {
  id: string;
  parent?: { page_id?: string };
  in_trash?: boolean;
  archived?: boolean;
};

describe('notion_delete', () => {
  const notion = makeClient(undefined);
  let parentPageId: string;

  beforeAll(async () => {
    const results = (await notion.search({ query: 'Deployment Plan', page_size: 1 })).results;
    expect(results.length).toBeGreaterThan(0);
    parentPageId = results[0].id;
  });

  it('creates a page then trashes it', async () => {
    const page = (await notion.pages.create({
      parent: { page_id: parentPageId },
      properties: {
        title: { title: [{ type: 'text', text: { content: '[vitest] trash-me' } }] },
      },
      markdown: 'This page will be trashed by tests.',
    })) as MinimalPage;

    const trashedPage = (await deleteNotionPage(notion, { page_id: page.id })) as MinimalPage;
    expect(trashedPage.in_trash === true || trashedPage.archived === true).toBe(true);
  }, 15000);

  it('rejects trashing an invalid page ID', async () => {
    await expect(
      deleteNotionPage(notion, { page_id: '00000000-0000-0000-0000-000000000000' })
    ).rejects.toThrow();
  });
});

describe('notion_move', () => {
  const notion = makeClient(undefined);
  let parentPageId: string;
  let secondParentId: string;
  let movePageId: string;

  beforeAll(async () => {
    const results = (await notion.search({ query: 'Deployment Plan', page_size: 1 })).results;
    expect(results.length).toBeGreaterThan(0);
    parentPageId = results[0].id;
    secondParentId = (
      (await notion.pages.create({
        parent: { page_id: parentPageId },
        properties: {
          title: {
            title: [{ type: 'text', text: { content: '[vitest] move-destination' } }],
          },
        },
        markdown: 'Move target.',
      })) as MinimalPage
    ).id;

    movePageId = (
      (await notion.pages.create({
        parent: { page_id: parentPageId },
        properties: {
          title: {
            title: [{ type: 'text', text: { content: '[vitest] page-to-move' } }],
          },
        },
        markdown: 'I will be moved.',
      })) as MinimalPage
    ).id;
  }, 20000);

  afterAll(async () => {
    if (movePageId) {
      await deleteNotionPage(notion, { page_id: movePageId }).catch(() => {});
    }
    if (secondParentId) {
      await deleteNotionPage(notion, { page_id: secondParentId }).catch(() => {});
    }
  });

  it('moves a page to a new parent', async () => {
    await moveNotionPage(notion, { page_id: movePageId, new_parent_id: secondParentId });
    const page = (await notion.pages.retrieve({ page_id: movePageId })) as MinimalPage;
    expect(page.parent?.page_id?.replace(/-/g, '')).toBe(secondParentId.replace(/-/g, ''));
  }, 15000);

  it('rejects moving to an invalid parent', async () => {
    await expect(
      moveNotionPage(notion, {
        page_id: movePageId,
        new_parent_id: '00000000-0000-0000-0000-000000000000',
      })
    ).rejects.toThrow();
  });
});

describe('notion_publish', () => {
  const notion = makeClient(undefined);
  let testPageId: string;

  beforeAll(async () => {
    const results = (await notion.search({ query: 'Projects', page_size: 1 })).results;
    expect(results.length).toBeGreaterThan(0);
    testPageId = results[0].id;
  });

  it('returns a stub report with supported=false', async () => {
    const result = await publishNotionPage(notion, { page_id: testPageId });
    expect(result.supported).toBe(false);
    expect(result.page_id).toBe(testPageId);
    expect(result.requested_state).toBe(true);
    expect(result.url).toBeDefined();
    expect(result.message.length).toBeGreaterThan(10);
  });

  it('respects the published=false parameter', async () => {
    expect(
      (await publishNotionPage(notion, { page_id: testPageId, published: false })).requested_state
    ).toBe(false);
  });
});

describe('notion_file_tree', () => {
  const notion = makeClient(undefined);
  let rootPageId: string;

  beforeAll(async () => {
    const results = (await notion.search({ query: 'Projects', page_size: 1 })).results;
    expect(results.length).toBeGreaterThan(0);
    rootPageId = results[0].id;
  });

  it('returns a tree structure with title, id, url, type, children', async () => {
    const tree = await getNotionFileTree(notion, { page_id: rootPageId, max_depth: 1 });
    expect(tree.title).toBeDefined();
    expect(tree.id).toBe(rootPageId);
    expect(tree.type).toBe('page');
    expect(Array.isArray(tree.children)).toBe(true);
    expect(tree.url).toMatch(/^https:\/\/www\.notion\.so\//);
  }, 30000);

  it('respects max_depth=0 and returns no children', async () => {
    expect(
      (await getNotionFileTree(notion, { page_id: rootPageId, max_depth: 0 })).children.length
    ).toBe(0);
  });

  it('child nodes have the expected shape', async () => {
    const tree = await getNotionFileTree(notion, { page_id: rootPageId, max_depth: 1 });
    for (const child of tree.children) {
      expect(child.id).toBeDefined();
      expect(child.title).toBeDefined();
      expect(['page', 'database']).toContain(child.type);
      expect(Array.isArray(child.children)).toBe(true);
    }
  }, 30000);

  it('secondary agent cannot enumerate pages from the default workspace', async () => {
    const secondaryAgent = process.env.NOTION_SECONDARY_AGENT ?? 'secondary';
    await expect(
      getNotionFileTree(makeClient(secondaryAgent), { page_id: rootPageId, max_depth: 1 })
    ).rejects.toThrow();
  });
});
