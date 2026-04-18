/**
 * Tests for notion_sync — push, pull, and auto sync between local files and Notion.
 *
 * Each test file creates its own dedicated parent page in beforeAll().
 * All fixtures are children of that parent. afterAll() deletes the parent,
 * cascading to all children. Tests NEVER touch existing workspace content.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncNotionFile } from '../src/index.js';
import { createTestParent, deleteTestParent, makeClient } from './helpers.js';

describe('notion_sync', () => {
  const notion = makeClient(undefined);
  let parentId: string;
  let tmpDir: string;

  beforeAll(async () => {
    parentId = await createTestParent(notion, 'sync');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-sync-test-'));
  });

  afterAll(async () => {
    if (parentId) await deleteTestParent(notion, parentId);
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('push: creates a new Notion page from a local file', async () => {
    const filePath = path.join(tmpDir, 'push-test.md');
    fs.writeFileSync(
      filePath,
      `---
title: Push Test
---
# Push Test

Created by vitest.`,
      'utf8'
    );

    const result = await syncNotionFile(notion, {
      path: filePath,
      parent_id: parentId,
      direction: 'push',
    });

    expect(result.direction).toBe('push');
    expect(result.url).toMatch(/^https:\/\/www\.notion\.so\//);
    expect(fs.readFileSync(filePath, 'utf8')).toContain(`notion_id: ${result.page_id}`);
  }, 20000);

  it('push: updates an existing Notion page when notion_id is in frontmatter', async () => {
    const filePath = path.join(tmpDir, 'push-update-test.md');
    fs.writeFileSync(
      filePath,
      `---
title: Update Test
---
# Original Content`,
      'utf8'
    );

    const createResult = await syncNotionFile(notion, {
      path: filePath,
      parent_id: parentId,
      direction: 'push',
    });

    fs.writeFileSync(
      filePath,
      fs.readFileSync(filePath, 'utf8').replace(
        '# Original Content',
        `# Updated Content

This was modified.`
      ),
      'utf8'
    );

    const updateResult = await syncNotionFile(notion, { path: filePath, direction: 'push' });
    expect(updateResult.page_id).toBe(createResult.page_id);
    expect(updateResult.direction).toBe('push');
  }, 25000);

  it('pull: downloads a Notion page to a local file', async () => {
    // Create a page first via sync, then pull it
    const filePath1 = path.join(tmpDir, 'pull-source.md');
    fs.writeFileSync(filePath1, `# Pull Source\n\nContent to pull.`, 'utf8');
    const created = await syncNotionFile(notion, {
      path: filePath1,
      parent_id: parentId,
      direction: 'push',
    });

    const filePath2 = path.join(tmpDir, 'pull-test.md');
    const result = await syncNotionFile(notion, {
      path: filePath2,
      page_id: created.page_id,
      direction: 'pull',
    });

    expect(result.direction).toBe('pull');
    expect(result.page_id).toBe(created.page_id);
    expect(fs.existsSync(filePath2)).toBe(true);
    expect(fs.readFileSync(filePath2, 'utf8')).toContain(created.page_id);
  }, 20000);

  it('auto: pulls when remote is newer than local', async () => {
    const filePath = path.join(tmpDir, 'auto-pull-test.md');
    fs.writeFileSync(filePath, `# Auto Pull Test\n\nContent.`, 'utf8');
    const _created = await syncNotionFile(notion, {
      path: filePath,
      page_id: parentId,
      direction: 'pull',
    });

    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(filePath, past, past);
    const result = await syncNotionFile(notion, { path: filePath, direction: 'auto' });
    expect(result.direction).toBe('pull');
    expect(result.reason).toContain('remote');
  }, 25000);

  it('auto: pushes when local is newer than remote', async () => {
    const filePath = path.join(tmpDir, 'auto-push-test.md');
    fs.writeFileSync(filePath, `# Auto Push Test\n\nContent.`, 'utf8');
    const _created = await syncNotionFile(notion, {
      path: filePath,
      page_id: parentId,
      direction: 'pull',
    });

    const content = fs.readFileSync(filePath, 'utf8');
    fs.writeFileSync(filePath, `${content}\n<!-- touched -->`, 'utf8');

    const result = await syncNotionFile(notion, { path: filePath, direction: 'auto' });
    expect(result.direction).toBe('push');
    expect(result.reason).toContain('local');
  }, 25000);

  it('rejects push of a nonexistent local file', async () => {
    await expect(
      syncNotionFile(notion, {
        path: path.join(tmpDir, 'does-not-exist.md'),
        parent_id: parentId,
        direction: 'push',
      })
    ).rejects.toThrow();
  });

  it('rejects pull without page_id or notion_id', async () => {
    const filePath = path.join(tmpDir, 'no-id.md');
    fs.writeFileSync(
      filePath,
      `# No ID

Just content.`,
      'utf8'
    );
    await expect(syncNotionFile(notion, { path: filePath, direction: 'pull' })).rejects.toThrow();
  });
});
