/**
 * Test helpers for the Notion plugin.
 *
 * CORE RULE: Tests must NEVER touch existing workspace content.
 *
 * Every test file must call createTestParent() in beforeAll() to get its own
 * dedicated parent page. All fixture pages are created as children of this
 * parent. afterAll() deletes the dedicated parent, cascading to all children.
 * No test may use findParentPage() or any other method to discover existing
 * workspace content.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@notionhq/client';
import { NOTION_VERSION } from '../src/constants.js';

const NOTION_CONFIG_DIR = path.join(os.homedir(), '.config', 'notion');

/* ------------------------------------------------------------------ */
/*  Key resolution (mirrors src/auth.ts)                               */
/* ------------------------------------------------------------------ */

function detectSecondaryAgentId(): string {
  const secondaryKeyPath = path.join(NOTION_CONFIG_DIR, 'api_key_gf_agent');
  if (fs.existsSync(secondaryKeyPath)) {
    return 'gf_agent';
  }
  return 'secondary';
}

export function getSecondaryAgentId(): string {
  if (process.env.NOTION_SECONDARY_AGENT) return process.env.NOTION_SECONDARY_AGENT;
  if (fs.existsSync(path.join(NOTION_CONFIG_DIR, 'api_key_gf_agent'))) return 'gf_agent';
  return 'secondary';
}

export const SECONDARY_AGENT = getSecondaryAgentId();

export function getNotionApiKey(agentId?: string): string {
  if (agentId === undefined) {
    const defaultKeyPath = path.join(NOTION_CONFIG_DIR, 'api_key');
    if (fs.existsSync(defaultKeyPath)) {
      return fs.readFileSync(defaultKeyPath, 'utf8').trim();
    }
    throw new Error(
      `Notion API key not found for the default agent. ` +
        `Expected at ${NOTION_CONFIG_DIR}/api_key.`
    );
  }

  if (agentId === 'secondary') {
    const envAgent = process.env.NOTION_SECONDARY_AGENT ?? detectSecondaryAgentId();
    const resolvedAgent = envAgent === 'secondary' ? detectSecondaryAgentId() : envAgent;
    const agentKeyPath = path.join(NOTION_CONFIG_DIR, `api_key_${resolvedAgent}`);
    if (fs.existsSync(agentKeyPath)) {
      return fs.readFileSync(agentKeyPath, 'utf8').trim();
    }
    const defaultKeyPath = path.join(NOTION_CONFIG_DIR, 'api_key');
    if (fs.existsSync(defaultKeyPath)) {
      return fs.readFileSync(defaultKeyPath, 'utf8').trim();
    }
    throw new Error(
      `Notion API key not found for agent "${envAgent}". ` +
        `Expected at ${agentKeyPath} or ${NOTION_CONFIG_DIR}/api_key.`
    );
  }

  const agentKeyPath = path.join(NOTION_CONFIG_DIR, `api_key_${agentId}`);
  if (fs.existsSync(agentKeyPath)) {
    return fs.readFileSync(agentKeyPath, 'utf8').trim();
  }

  const defaultKeyPath = path.join(NOTION_CONFIG_DIR, 'api_key');
  if (fs.existsSync(defaultKeyPath)) {
    return fs.readFileSync(defaultKeyPath, 'utf8').trim();
  }

  throw new Error(
    `Notion API key not found for agent "${agentId}". ` +
      `Expected at ${agentKeyPath} or ${NOTION_CONFIG_DIR}/api_key.`
  );
}

export function makeClient(agentId?: string): Client {
  return new Client({
    auth: getNotionApiKey(agentId),
    notionVersion: NOTION_VERSION,
  });
}

/* ------------------------------------------------------------------ */
/*  Test fixture helpers — NEVER use existing workspace pages          */
/* ------------------------------------------------------------------ */

type MinimalPage = { id: string };

/**
 * Create a dedicated parent page for a test file.
 *
 * Creates a top-level page under the workspace root named
 * "[vitest] {testFileName}". All fixture pages for this test file
 * should be created as children of the returned parent ID.
 *
 * If the integration cannot create workspace-level pages (internal
 * integration restriction), creates the parent as a child of the
 * first accessible page instead — but always creates its OWN page,
 * never touches existing content.
 *
 * @param notion - Authenticated Notion client for the target agent
 * @param testFileName - Unique name for this test file (e.g. "core-tools")
 * @returns The parent page ID
 * @throws If the workspace is inaccessible
 */
export async function createTestParent(notion: Client, testFileName: string): Promise<string> {
  const parentTitle = `[vitest] ${testFileName}-${Date.now()}`;

  // Strategy 1: Try to create at workspace root (ideal — completely isolated)
  try {
    const page = (await notion.pages.create({
      parent: { type: 'workspace' as const },
      properties: {
        title: { title: [{ type: 'text', text: { content: parentTitle } }] },
      },
    })) as MinimalPage;
    return page.id;
  } catch (err) {
    // If the integration can't create at workspace root, fall through to strategy 2
    const e = err as { code?: string; message?: string };
    if (e.code !== 'internal_server_error' && !String(e.message).includes('workspace')) {
      throw err;
    }
  }

  // Strategy 2: Find ANY existing page in the workspace and create the
  // test parent as a child of it. The existing page is not modified —
  // we only use it as an anchor point. The test parent itself is new content.
  const search = await notion.search({ query: '', page_size: 3 });
  const firstPage = search.results.find((r) => r.object === 'page');
  if (!firstPage) {
    throw new Error(
      `Cannot create test parent for "${testFileName}": ` +
        `workspace-level creation failed and no pages found to anchor a child page. ` +
        `The workspace appears to be empty or inaccessible.`
    );
  }

  const page = (await notion.pages.create({
    parent: { page_id: firstPage.id },
    properties: {
      title: { title: [{ type: 'text', text: { content: parentTitle } }] },
    },
  })) as MinimalPage;
  return page.id;
}

/**
 * Delete a test parent page. This cascades to all child pages.
 * Safe to call on an already-deleted ID (no-op).
 */
export async function deleteTestParent(notion: Client, parentId: string): Promise<void> {
  try {
    await notion.pages.update({ page_id: parentId, in_trash: true });
  } catch (err) {
    // Already deleted — no-op
    const e = err as { code?: string };
    // Deleted or its parent/ancestor was already deleted — nothing left to clean up.
    if (e.code === 'object_not_found' || e.code === 'archived_ancestor') return;
    throw err;
  }
}

/**
 * Create a fixture page as a child of the given parent.
 * Always uses a unique title to avoid conflicts.
 *
 * Retries with a fresh parent if Notion rejects the create due to
 * an archived ancestor on the parent page (up to 3 attempts).
 */
export async function createTestPage(
  notion: Client,
  parentId: string,
  title: string,
  markdown = ''
): Promise<MinimalPage> {
  const MAX_RETRIES = 3;

  const isArchivedAncestorError = (err: unknown): boolean => {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as { code?: string; message?: string };
    return e.code === 'validation_error' && !!e.message?.includes('archived ancestor');
  };

  const tryCreate = async (pid: string): Promise<MinimalPage> =>
    (await notion.pages.create({
      parent: { page_id: pid },
      properties: {
        title: { title: [{ type: 'text', text: { content: title } }] },
      },
      ...(markdown ? { markdown } : {}),
    })) as MinimalPage;

  let lastError: unknown;
  let currentParent = parentId;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await tryCreate(currentParent);
    } catch (err) {
      lastError = err;
      if (!isArchivedAncestorError(err)) throw err;
      // Parent has archived ancestor — try to create a new parent page instead
      // (This can happen if the test parent itself was somehow archived)
      const freshParent = await createTestParent(notion, `orphaned-retry-${Date.now()}`);
      if (freshParent === currentParent) break;
      currentParent = freshParent;
    }
  }

  throw lastError;
}
