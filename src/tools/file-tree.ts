import type { Client } from "@notionhq/client";
import { DEFAULT_PAGE_SIZE } from "../constants.js";
import { extractPageTitle, retrieveDatabaseMetadata, retrievePageMetadata } from "../helpers.js";
import type { AnyBlock, FileTreeParams, TreeNode } from "../types.js";

export async function buildFileTreeNode(
  notion: Client,
  pageId: string,
  maxDepth: number,
  depth = 0,
): Promise<TreeNode> {
  const page = await retrievePageMetadata(notion, pageId);
  const node: TreeNode = {
    title: extractPageTitle(page),
    id: page.id,
    url: page.url ?? null,
    type: "page",
    children: [],
  };

  if (depth >= maxDepth) {
    return node;
  }

  let startCursor: string | undefined;
  do {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: startCursor,
      page_size: DEFAULT_PAGE_SIZE,
    });

    for (const block of response.results) {
      const currentBlock = block as AnyBlock;
      if (currentBlock.type === "child_page") {
        node.children.push(await buildFileTreeNode(notion, currentBlock.id, maxDepth, depth + 1));
      } else if (currentBlock.type === "child_database") {
        const database = await retrieveDatabaseMetadata(notion, currentBlock.id);
        node.children.push({
          title: extractPageTitle(database),
          id: database.id,
          url: database.url ?? null,
          type: "database",
          children: [],
        });
      }
    }

    startCursor = response.next_cursor ?? undefined;
  } while (startCursor);

  return node;
}

export async function getNotionFileTree(notion: Client, params: FileTreeParams) {
  return buildFileTreeNode(notion, params.page_id, params.max_depth ?? 3);
}
