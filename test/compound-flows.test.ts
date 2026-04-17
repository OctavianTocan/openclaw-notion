/**
 * Compound / end-to-end flow tests.
 *
 * Each test exercises a realistic multi-tool workflow rather than a
 * single API call. All resources are created fresh and cleaned up
 * in afterAll — nothing depends on pre-existing workspace content
 * (except the parent page, discovered via search).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deleteNotionPage,
  getMarkdownPagesApi,
  getNotionFileTree,
  moveNotionPage,
  syncNotionFile,
} from '../src/index.js';
import { makeClient } from './helpers.js';

const SECONDARY_AGENT = process.env.NOTION_SECONDARY_AGENT ?? 'secondary';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Collect page IDs for bulk cleanup. */
const garbage: string[] = [];

function scheduleCleanup(id: string) {
  garbage.push(id);
  return id;
}

async function createTestPage(
  notion: ReturnType<typeof makeClient>,
  parentId: string,
  title: string,
  markdown = ''
) {
  const page = await notion.pages.create({
    parent: { page_id: parentId },
    properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
    ...(markdown ? { markdown } : {}),
  });
  scheduleCleanup(page.id);
  return page;
}

/* ------------------------------------------------------------------ */
/*  Flow 1 — Full page lifecycle                                       */
/* ------------------------------------------------------------------ */

describe('Flow 1: Full page lifecycle', () => {
  const notion = makeClient(undefined);
  let parentId: string;
  let pageId: string;

  beforeAll(async () => {
    const results = (await notion.search({ query: '', page_size: 1 })).results;
    expect(results.length).toBeGreaterThan(0);
    parentId = results[0].id;
  });

  afterAll(async () => {
    for (const id of garbage) {
      await deleteNotionPage(notion, { page_id: id }).catch(() => {});
    }
  });

  it('creates a page with markdown', async () => {
    const page = await createTestPage(
      notion,
      parentId,
      '[flow1] Lifecycle Test',
      '# Hello\n\nCreated by compound flow test.'
    );
    pageId = page.id;
    expect(page.object).toBe('page');
    expect(page.url).toMatch(/^https:\/\/www\.notion\.so\//);
  }, 15000);

  it('reads it back as markdown', async () => {
    expect(pageId).toBeDefined();
    const md = await getMarkdownPagesApi(notion).retrieveMarkdown({ page_id: pageId });
    expect(md.object).toBe('page_markdown');
    expect(md.markdown).toContain('Created by compound flow test');
  });

  it('updates the markdown content', async () => {
    const updated = await getMarkdownPagesApi(notion).updateMarkdown({
      page_id: pageId,
      type: 'replace_content',
      replace_content: { new_str: '# Updated\n\nContent was replaced.' },
    });
    expect(updated.markdown).toContain('Content was replaced');
  });

  it('updates the title and icon', async () => {
    const updated = await notion.pages.update({
      page_id: pageId,
      icon: { type: 'emoji', emoji: '🧪' },
      properties: {
        title: { title: [{ type: 'text', text: { content: '[flow1] Renamed' } }] },
      },
    });
    expect((updated as any).icon?.emoji).toBe('🧪');
  });

  it('adds a comment and lists it', async () => {
    await notion.comments.create({
      parent: { page_id: pageId },
      rich_text: [{ type: 'text', text: { content: 'Flow 1 comment' } }],
    });
    const comments = await notion.comments.list({ block_id: pageId });
    expect(
      comments.results.some((c) => c.rich_text.some((t) => t.plain_text === 'Flow 1 comment'))
    ).toBe(true);
  });

  it('deletes the page', async () => {
    const trashed = (await deleteNotionPage(notion, { page_id: pageId })) as any;
    expect(trashed.in_trash === true || trashed.archived === true).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Flow 2 — Sync round-trip                                           */
/* ------------------------------------------------------------------ */

describe('Flow 2: Sync round-trip', () => {
  const notion = makeClient(undefined);
  let parentId: string;
  let tmpDir: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const results = (await notion.search({ query: '', page_size: 1 })).results;
    expect(results.length).toBeGreaterThan(0);
    parentId = results[0].id;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow2-sync-'));
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await deleteNotionPage(notion, { page_id: id }).catch(() => {});
    }
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('pushes a local file to Notion, modifies remote, pulls back with frontmatter intact', async () => {
    const filePath = path.join(tmpDir, 'round-trip.md');
    fs.writeFileSync(
      filePath,
      '---\ntitle: Round Trip\ncustom_key: preserve_me\n---\n# Round Trip\n\nOriginal local content.',
      'utf8'
    );

    // Push local → Notion
    const pushResult = await syncNotionFile(notion, {
      path: filePath,
      parent_id: parentId,
      direction: 'push',
    });
    createdIds.push(pushResult.page_id);
    expect(pushResult.direction).toBe('push');

    // Verify notion_id stamped into frontmatter
    const afterPush = fs.readFileSync(filePath, 'utf8');
    expect(afterPush).toContain(`notion_id: ${pushResult.page_id}`);
    expect(afterPush).toContain('custom_key: preserve_me');

    // Modify content on Notion side
    await getMarkdownPagesApi(notion).updateMarkdown({
      page_id: pushResult.page_id,
      type: 'replace_content',
      replace_content: { new_str: '# Round Trip\n\nRemotely modified content.' },
    });

    // Pull Notion → local
    const pullResult = await syncNotionFile(notion, {
      path: filePath,
      direction: 'pull',
    });
    expect(pullResult.direction).toBe('pull');

    // Verify local absorbed remote changes AND preserved custom frontmatter
    const afterPull = fs.readFileSync(filePath, 'utf8');
    expect(afterPull).toContain('Remotely modified content');
    expect(afterPull).toContain('custom_key: preserve_me');
    expect(afterPull).toContain(`notion_id: ${pushResult.page_id}`);
  }, 30000);
});

/* ------------------------------------------------------------------ */
/*  Flow 3 — Move + tree verification                                  */
/* ------------------------------------------------------------------ */

describe('Flow 3: Move + tree verification', () => {
  const notion = makeClient(undefined);
  let rootId: string;
  let parentA: string;
  let parentB: string;
  let childId: string;

  beforeAll(async () => {
    const results = (await notion.search({ query: '', page_size: 1 })).results;
    expect(results.length).toBeGreaterThan(0);
    rootId = results[0].id;
  });

  afterAll(async () => {
    for (const id of [childId, parentB, parentA]) {
      if (id) await deleteNotionPage(notion, { page_id: id }).catch(() => {});
    }
  });

  it('moves a child between parents and file_tree reflects the change', async () => {
    // Create two parent containers
    parentA = (await createTestPage(notion, rootId, '[flow3] Parent A')).id;
    parentB = (await createTestPage(notion, rootId, '[flow3] Parent B')).id;

    // Create child under A
    const child = await createTestPage(notion, parentA, '[flow3] Child');
    childId = child.id;

    // Verify tree shows child under A
    const treeA = await getNotionFileTree(notion, { page_id: parentA, max_depth: 1 });
    expect(treeA.children.some((c) => c.id === childId)).toBe(true);

    const treeBBefore = await getNotionFileTree(notion, { page_id: parentB, max_depth: 1 });
    expect(treeBBefore.children.some((c) => c.id === childId)).toBe(false);

    // Move child from A → B
    await moveNotionPage(notion, { page_id: childId, new_parent_id: parentB });

    // Verify tree now shows child under B, not A
    const treeAAfter = await getNotionFileTree(notion, { page_id: parentA, max_depth: 1 });
    expect(treeAAfter.children.some((c) => c.id === childId)).toBe(false);

    const treeBAfter = await getNotionFileTree(notion, { page_id: parentB, max_depth: 1 });
    expect(treeBAfter.children.some((c) => c.id === childId)).toBe(true);
  }, 45000);
});

/* ------------------------------------------------------------------ */
/*  Flow 4 — Search → read → sync pipeline                            */
/* ------------------------------------------------------------------ */

describe('Flow 4: Search → read → sync pipeline', () => {
  const notion = makeClient(undefined);
  let tmpDir: string;
  let testPageId: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow4-pipeline-'));
  });

  afterAll(async () => {
    if (testPageId) await deleteNotionPage(notion, { page_id: testPageId }).catch(() => {});
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('search → read → pull-sync → local modify → push back', async () => {
    // Use an existing page discovered via search (avoids Notion indexing delay
    // on freshly-created pages, which can take 10+ seconds to appear in search).
    const searchResult = await notion.search({ query: '', page_size: 1 });
    expect(searchResult.results.length).toBeGreaterThan(0);
    const existingPageId = searchResult.results[0].id;

    // Create our own child page under it so we control the content.
    const page = await createTestPage(
      notion,
      existingPageId,
      '[flow4] Pipeline Test',
      'Pipeline test content.'
    );
    testPageId = page.id;

    // Read its blocks
    const blocks = await notion.blocks.children.list({ block_id: testPageId });
    expect(Array.isArray(blocks.results)).toBe(true);

    // Pull-sync to local file
    const filePath = path.join(tmpDir, 'pipeline.md');
    const pullResult = await syncNotionFile(notion, {
      path: filePath,
      page_id: testPageId,
      direction: 'pull',
    });
    expect(pullResult.direction).toBe('pull');
    expect(fs.existsSync(filePath)).toBe(true);

    // Modify locally and push back
    const content = fs.readFileSync(filePath, 'utf8');
    fs.writeFileSync(
      filePath,
      content.replace('Pipeline test content', 'Modified locally'),
      'utf8'
    );

    const pushResult = await syncNotionFile(notion, { path: filePath, direction: 'push' });
    expect(pushResult.direction).toBe('push');
    expect(pushResult.page_id).toBe(testPageId);

    // Verify Notion has the updated content
    const md = await getMarkdownPagesApi(notion).retrieveMarkdown({ page_id: testPageId });
    expect(md.markdown).toContain('Modified locally');
  }, 60000);
});

/* ------------------------------------------------------------------ */
/*  Flow 5 — Multi-agent collision (bidirectional isolation)           */
/* ------------------------------------------------------------------ */

describe('Flow 5: Multi-agent collision', () => {
  const defaultNotion = makeClient(undefined);
  const secondaryNotion = makeClient(SECONDARY_AGENT);
  let defaultPageId: string;
  let secondaryPageId: string;
  let defaultParentId: string;

  beforeAll(async () => {
    // Find a parent in each workspace
    const defaultResults = (await defaultNotion.search({ query: '', page_size: 1 })).results;
    expect(defaultResults.length).toBeGreaterThan(0);
    defaultParentId = defaultResults[0].id;
  });

  afterAll(async () => {
    if (defaultPageId)
      await deleteNotionPage(defaultNotion, { page_id: defaultPageId }).catch(() => {});
    if (secondaryPageId)
      await deleteNotionPage(secondaryNotion, { page_id: secondaryPageId }).catch(() => {});
  });

  it('default creates a page — secondary cannot read, update, or delete it', async () => {
    const page = await defaultNotion.pages.create({
      parent: { page_id: defaultParentId },
      properties: {
        title: { title: [{ type: 'text', text: { content: '[flow5] Default Page' } }] },
      },
      markdown: 'Owned by default agent.',
    });
    defaultPageId = page.id;

    // Secondary cannot read blocks
    await expect(
      secondaryNotion.blocks.children.list({ block_id: defaultPageId })
    ).rejects.toThrow();

    // Secondary cannot read markdown
    await expect(
      getMarkdownPagesApi(secondaryNotion).retrieveMarkdown({ page_id: defaultPageId })
    ).rejects.toThrow();

    // Secondary cannot update markdown
    await expect(
      getMarkdownPagesApi(secondaryNotion).updateMarkdown({
        page_id: defaultPageId,
        type: 'replace_content',
        replace_content: { new_str: 'hijacked' },
      })
    ).rejects.toThrow();

    // Secondary cannot delete
    await expect(deleteNotionPage(secondaryNotion, { page_id: defaultPageId })).rejects.toThrow();

    // Secondary cannot move
    await expect(
      moveNotionPage(secondaryNotion, {
        page_id: defaultPageId,
        new_parent_id: defaultPageId,
      })
    ).rejects.toThrow();
  }, 20000);

  it('secondary creates a page — default cannot read or modify it', async () => {
    // Find a parent in secondary workspace
    const secondaryResults = (await secondaryNotion.search({ query: '', page_size: 1 })).results;
    expect(secondaryResults.length).toBeGreaterThan(0);
    const secondaryParentId = secondaryResults[0].id;

    const page = await secondaryNotion.pages.create({
      parent: { page_id: secondaryParentId },
      properties: {
        title: { title: [{ type: 'text', text: { content: '[flow5] Secondary Page' } }] },
      },
      markdown: 'Owned by secondary agent.',
    });
    secondaryPageId = page.id;

    // Default cannot read blocks
    await expect(
      defaultNotion.blocks.children.list({ block_id: secondaryPageId })
    ).rejects.toThrow();

    // Default cannot read markdown
    await expect(
      getMarkdownPagesApi(defaultNotion).retrieveMarkdown({ page_id: secondaryPageId })
    ).rejects.toThrow();

    // Default cannot delete
    await expect(deleteNotionPage(defaultNotion, { page_id: secondaryPageId })).rejects.toThrow();
  }, 20000);
});
