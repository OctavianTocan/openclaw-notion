/**
 * Tests for notion_delete, notion_move, notion_publish, notion_file_tree.
 *
 * Each test file creates its own dedicated parent page in beforeAll().
 * All fixtures are children of that parent. afterAll() deletes the parent,
 * cascading to all children. Tests NEVER touch existing workspace content.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deleteNotionPage,
  getNotionFileTree,
  moveNotionPage,
  publishNotionPage,
} from '../src/index.js';
import { createTestPage, createTestParent, deleteTestParent, makeClient } from './helpers.js';

type MinimalPage = {
  id: string;
  parent?: { page_id?: string };
  in_trash?: boolean;
  archived?: boolean;
};

describe('notion_delete', () => {
  const notion = makeClient(undefined);
  let parentId: string;

  beforeAll(async () => {
    parentId = await createTestParent(notion, 'phase1-delete');
  });

  afterAll(async () => {
    if (parentId) await deleteTestParent(notion, parentId);
  });

  it('creates a page then trashes it', async () => {
    const page = (await createTestPage(
      notion,
      parentId,
      '[vitest] trash-me'
    )) as MinimalPage;
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
  let parentId: string;

  beforeAll(async () => {
    parentId = await createTestParent(notion, 'phase1-move');
  });

  afterAll(async () => {
    if (parentId) await deleteTestParent(notion, parentId);
  });

  it('moves a page to a new parent', async () => {
    const secondParentId = (
      (await createTestPage(notion, parentId, '[vitest] move-destination')) as MinimalPage
    ).id;

    const movePageId = (
      (await createTestPage(
        notion,
        parentId,
        '[vitest] page-to-move'
      )) as MinimalPage
    ).id;

    await moveNotionPage(notion, { page_id: movePageId, new_parent_id: secondParentId });
    const page = (await notion.pages.retrieve({ page_id: movePageId })) as MinimalPage;
    expect(page.parent?.page_id?.replace(/-/g, '')).toBe(secondParentId.replace(/-/g, ''));
  }, 15000);

  it('rejects moving to an invalid parent', async () => {
    const page = (await createTestPage(
      notion,
      parentId,
      '[vitest] move-invalid-page'
    )) as MinimalPage;
    await expect(
      moveNotionPage(notion, {
        page_id: page.id,
        new_parent_id: '00000000-0000-0000-0000-000000000000',
      })
    ).rejects.toThrow();
  });
});

describe('notion_publish', () => {
  const notion = makeClient(undefined);
  let parentId: string;

  beforeAll(async () => {
    parentId = await createTestParent(notion, 'phase1-publish');
  });

  afterAll(async () => {
    if (parentId) await deleteTestParent(notion, parentId);
  });

  it('returns a stub report with supported=false', async () => {
    const result = await publishNotionPage(notion, { page_id: parentId });
    expect(result.supported).toBe(false);
    expect(result.page_id).toBe(parentId);
    expect(result.requested_state).toBe(true);
    expect(result.url).toBeDefined();
    expect(result.message.length).toBeGreaterThan(10);
  });

  it('respects the published=false parameter', async () => {
    expect(
      (await publishNotionPage(notion, { page_id: parentId, published: false })).requested_state
    ).toBe(false);
  });
});

describe('notion_file_tree', () => {
  const notion = makeClient(undefined);
  let parentId: string;

  beforeAll(async () => {
    parentId = await createTestParent(notion, 'phase1-file-tree');
  });

  afterAll(async () => {
    if (parentId) await deleteTestParent(notion, parentId);
  });

  it('returns a tree structure with title, id, url, type, children', async () => {
    // Create child pages for the tree.
    await createTestPage(notion, parentId, '[vitest] child-a');
    await createTestPage(notion, parentId, '[vitest] child-b');

    const tree = await getNotionFileTree(notion, { page_id: parentId, max_depth: 1 });
    expect(tree.title).toBeDefined();
    expect(tree.id).toBe(parentId);
    expect(tree.type).toBe('page');
    expect(Array.isArray(tree.children)).toBe(true);
    expect(tree.url).toMatch(/^https:\/\/www\.notion\.so\//);
  }, 30000);

  it('respects max_depth=0 and returns no children', async () => {
    expect(
      (await getNotionFileTree(notion, { page_id: parentId, max_depth: 0 })).children.length
    ).toBe(0);
  });

  it('child nodes have the expected shape', async () => {
    const tree = await getNotionFileTree(notion, { page_id: parentId, max_depth: 1 });
    for (const child of tree.children) {
      expect(child.id).toBeDefined();
      expect(child.title).toBeDefined();
      expect(['page', 'database']).toContain(child.type);
      expect(Array.isArray(child.children)).toBe(true);
    }
  }, 30000);
});
