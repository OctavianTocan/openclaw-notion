/**
 * Recursive page/database tree walker.
 *
 * Builds a nested {@link TreeNode} structure by traversing child_page and
 * child_database blocks. Respects a configurable depth limit to avoid
 * runaway recursion on deep Notion hierarchies.
 */

import type { Client } from '@notionhq/client';
import { DEFAULT_PAGE_SIZE } from '../constants.js';
import { extractPageTitle, retrieveDatabaseMetadata, retrievePageMetadata } from '../helpers.js';
import type { AnyBlock, AnyPage, FileTreeParams, TreeNode } from '../types.js';

/**
 * Recursively build a tree node for a single Notion page.
 *
 * Walks the page's block children, descending into `child_page` blocks and
 * recording `child_database` blocks as leaf nodes.
 *
 * @param notion - Authenticated Notion client.
 * @param pageId - UUID of the page to enumerate.
 * @param maxDepth - Maximum recursion depth (0 = current page only).
 * @param depth - Current recursion depth (used internally).
 * @returns A {@link TreeNode} representing the page and its descendants.
 */
async function buildFileTreeNode(
  notion: Client,
  pageId: string,
  maxDepth: number,
  depth = 0
): Promise<TreeNode> {
  const page = await retrievePageMetadata(notion, pageId);
  const node: TreeNode = {
    title: extractPageTitle(page),
    id: page.id,
    url: page.url ?? null,
    type: 'page',
    children: [],
  };

  if (depth >= maxDepth) {
    return node;
  }

  // Paginate through all block children.
  let startCursor: string | undefined;
  do {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: startCursor,
      page_size: DEFAULT_PAGE_SIZE,
    });

    for (const block of response.results) {
      const currentBlock = block as AnyBlock;
      if (currentBlock.type === 'child_page') {
        node.children.push(await buildFileTreeNode(notion, currentBlock.id, maxDepth, depth + 1));
      } else if (currentBlock.type === 'child_database') {
        const database = await retrieveDatabaseMetadata(notion, currentBlock.id);
        node.children.push({
          title: extractPageTitle(database),
          id: database.id,
          url: database.url ?? null,
          type: 'database',
          children: [],
        });
      }
    }

    startCursor = response.next_cursor ?? undefined;
  } while (startCursor);

  // Supplementary discovery: find child pages created via pages.create() that
  // may not appear as child_page blocks in blocks.children.list(). A single
  // search call (capped at 100) catches the common case without paginating
  // through the entire workspace, which would timeout on large workspaces.
  const seenIds = new Set(node.children.map((c) => c.id));
  const searchResponse = await notion.search({
    query: '',
    filter: { property: 'object', value: 'page' },
    page_size: 100,
  });

  for (const result of searchResponse.results) {
    const resultPage = result as AnyPage;
    if (resultPage.parent?.page_id === pageId && !seenIds.has(resultPage.id)) {
      seenIds.add(resultPage.id);
      node.children.push(await buildFileTreeNode(notion, resultPage.id, maxDepth, depth + 1));
    }
  }

  return node;
}

/**
 * Enumerate the child pages and databases under a root page.
 *
 * @param notion - Authenticated Notion client.
 * @param params - Contains `page_id` and optional `max_depth` (default 3).
 * @returns A recursive {@link TreeNode} starting from the given page.
 */
export async function getNotionFileTree(notion: Client, params: FileTreeParams) {
  return buildFileTreeNode(notion, params.page_id, params.max_depth ?? 3);
}
