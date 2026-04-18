/**
 * Tests for compound flows: create → update → append → move → delete.
 *
 * Each test file creates its own dedicated parent page in beforeAll().
 * All fixtures are children of that parent. afterAll() deletes the parent,
 * cascading to all children. Tests NEVER touch existing workspace content.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteNotionPage, getMarkdownPagesApi } from '../src/index.js';
import { createTestPage, createTestParent, deleteTestParent, makeClient } from './helpers.js';

type MinimalPage = {
  id: string;
  object?: string;
  parent?: { page_id?: string };
  in_trash?: boolean;
  archived?: boolean;
  properties?: Record<string, unknown>;
};

describe('Compound flows', () => {
  const notion = makeClient(undefined);
  let parentId: string;

  beforeAll(async () => {
    parentId = await createTestParent(notion, 'compound-flows');
  });

  afterAll(async () => {
    if (parentId) await deleteTestParent(notion, parentId);
  });

  it('create → update title → append block → move → delete', async () => {
    // Create
    const page = (await createTestPage(notion, parentId, '[vitest] compound-test')) as MinimalPage;
    expect(page.object).toBe('page');

    // Update title
    const titleProp = Object.values(page.properties ?? {}).find(
      (p) => (p as { type?: string }).type === 'title'
    );
    const propName = titleProp
      ? (Object.entries(page.properties ?? {}).find(([, v]) => v === titleProp)?.[0] ?? 'title')
      : 'title';

    const updated = (await notion.pages.update({
      page_id: page.id,
      properties: {
        [propName]: {
          title: [{ type: 'text', text: { content: '[vitest] compound-renamed' } }],
        },
      },
    })) as MinimalPage;
    expect(updated.id).toBe(page.id);

    // Append block
    await notion.blocks.children.append({
      block_id: page.id,
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: 'Compound flow test block' } }],
          },
        },
      ],
    });
    const blocks = await notion.blocks.children.list({ block_id: page.id });
    expect(blocks.results.length).toBeGreaterThan(0);

    // Move to a new sibling parent
    const newParent = (await createTestPage(
      notion,
      parentId,
      '[vitest] compound-destination'
    )) as MinimalPage;
    await notion.pages.move({
      page_id: page.id,
      parent: { page_id: newParent.id },
    });
    const moved = (await notion.pages.retrieve({ page_id: page.id })) as MinimalPage;
    expect(moved.parent?.page_id?.replace(/-/g, '')).toBe(newParent.id.replace(/-/g, ''));
  }, 40000);

  it('create → update markdown → retrieve as markdown → delete', async () => {
    const root = await createTestPage(notion, parentId, `[vitest] md-compound-root-${Date.now()}`);
    const page = (await createTestPage(notion, root.id, '[vitest] md-compound')) as MinimalPage;

    const api = getMarkdownPagesApi(notion);
    await api.updateMarkdown({
      page_id: page.id,
      type: 'replace_content',
      replace_content: { new_str: '# Compound Markdown\n\nUpdated via compound test.' },
    });

    const retrieved = await api.retrieveMarkdown({ page_id: page.id });
    expect(retrieved.markdown).toContain('Compound Markdown');
    expect(retrieved.markdown).toContain('Updated via compound test.');
  }, 25000);

  it('create → delete: deleted page cannot accept new blocks', async () => {
    const page = (await createTestPage(notion, parentId, '[vitest] delete-verify')) as MinimalPage;
    await deleteNotionPage(notion, { page_id: page.id });

    // After trashing, appending should fail
    await expect(
      notion.blocks.children.append({
        block_id: page.id,
        children: [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content: 'should fail' } }] },
          },
        ],
      })
    ).rejects.toThrow();
  }, 15000);
});
