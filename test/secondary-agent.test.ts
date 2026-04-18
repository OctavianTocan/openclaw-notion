/**
 * Tests for the secondary agent (gf_agent / Esther's workspace).
 * Verifies workspace isolation and that the secondary agent key works.
 *
 * Each test file creates its own dedicated parent page in beforeAll().
 * All fixtures are children of that parent. afterAll() deletes the parent,
 * cascading to all children. Tests NEVER touch existing workspace content.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteNotionPage } from '../src/index.js';
import {
  createTestPage,
  createTestParent,
  deleteTestParent,
  getSecondaryAgentId,
  makeClient,
} from './helpers.js';

type MinimalPage = {
  id: string;
  object?: string;
  parent?: { page_id?: string };
  in_trash?: boolean;
  archived?: boolean;
};

const SECONDARY_AGENT = getSecondaryAgentId();

describe(`Secondary agent (${SECONDARY_AGENT})`, () => {
  const secondaryNotion = makeClient(SECONDARY_AGENT);
  let parentId: string;

  beforeAll(async () => {
    parentId = await createTestParent(secondaryNotion, 'secondary-agent');
  });

  afterAll(async () => {
    if (parentId) await deleteTestParent(secondaryNotion, parentId);
  });

  it('secondary agent can search its own workspace', async () => {
    const response = await secondaryNotion.search({ query: '', page_size: 5 });
    expect(Array.isArray(response.results)).toBe(true);
    // May or may not have results depending on workspace state — both are valid
  });

  it('secondary agent can create pages in its own workspace', async () => {
    const page = (await createTestPage(
      secondaryNotion,
      parentId,
      `[vitest] secondary-create-${Date.now()}`
    )) as MinimalPage;
    expect(page.object).toBe('page');
    expect(page.id).toBeDefined();
  });

  it('secondary agent can delete its own pages', async () => {
    const page = (await createTestPage(
      secondaryNotion,
      parentId,
      `[vitest] secondary-delete-${Date.now()}`
    )) as MinimalPage;
    const trashed = (await deleteNotionPage(secondaryNotion, {
      page_id: page.id,
    })) as MinimalPage;
    expect(trashed.in_trash === true || trashed.archived === true).toBe(true);
  });

  it('secondary agent cannot access pages from the default workspace by ID', async () => {
    // Try to access a page in the default workspace using the secondary client
    // It should fail with an authentication/permission error
    const defaultNotion = makeClient(undefined);
    // Create a real page in the default workspace first
    const defaultParent = await createTestParent(defaultNotion, 'secondary-isolation-anchor');
    try {
      const defaultPage = await createTestPage(
        defaultNotion,
        defaultParent,
        '[vitest] default-to-isolate'
      );
      // Secondary client must NOT be able to retrieve or delete this page
      await expect(
        secondaryNotion.pages.retrieve({ page_id: defaultPage.id })
      ).rejects.toThrow();
    } finally {
      if (defaultParent) await deleteTestParent(defaultNotion, defaultParent);
    }
  });
});
