/**
 * Bidirectional sync between local markdown files and Notion pages.
 *
 * Supports three modes:
 * - **push**: Local file → Notion (create or update)
 * - **pull**: Notion page → local file
 * - **auto**: Compare modification times and pick the fresher side
 *
 * YAML frontmatter in local files stores `notion_id` for round-trip identity.
 * The `gray-matter` library handles frontmatter parsing and serialisation.
 */

import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { Client } from '@notionhq/client';
import matter from 'gray-matter';
import {
  extractPageTitle,
  findTitlePropertyName,
  isRecord,
  retrievePageMetadata,
} from '../helpers.js';
import type { AnyPage, LocalFileState, MarkdownPageApi, SyncParams } from '../types.js';

/**
 * Cast the Notion client's `pages` namespace to the enhanced markdown API.
 *
 * @param notion - Authenticated Notion client.
 * @returns A handle exposing `retrieveMarkdown` and `updateMarkdown`.
 */
const getMarkdownPagesApi = (notion: Client) => notion.pages as unknown as MarkdownPageApi;

/**
 * Read and parse a local markdown file, extracting frontmatter and stats.
 *
 * @param filePath - Relative or absolute path to the file.
 * @returns Parsed local state including frontmatter data, body content,
 *   and filesystem stats. Returns `exists: false` when the file is missing.
 * @throws {Error} For filesystem errors other than ENOENT.
 */
export async function readLocalFileState(filePath: string): Promise<LocalFileState> {
  const absolutePath = path.resolve(filePath);
  try {
    const stat = await fsp.stat(absolutePath);
    const raw = await fsp.readFile(absolutePath, 'utf8');
    const parsed = matter(raw);
    return {
      absolutePath,
      exists: true,
      data: isRecord(parsed.data) ? parsed.data : {},
      content: parsed.content,
      stat,
    };
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return {
        absolutePath,
        exists: false,
        data: {},
        content: '',
        stat: null,
      };
    }
    throw error;
  }
}

/**
 * Derive a page title from the local file's frontmatter, first heading, or filename.
 *
 * Priority: frontmatter `title` → first `# Heading` → basename without extension.
 *
 * @param content - Markdown body (frontmatter already stripped).
 * @param absolutePath - Resolved file path (used as last-resort title).
 * @param data - Parsed frontmatter key-value pairs.
 * @returns The inferred title string.
 */
export function inferMarkdownTitle(
  content: string,
  absolutePath: string,
  data: Record<string, unknown>
) {
  const frontmatterTitle = typeof data.title === 'string' ? data.title.trim() : '';
  if (frontmatterTitle) {
    return frontmatterTitle;
  }

  const heading = content
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('# '))
    ?.replace(/^#\s+/, '')
    .trim();
  if (heading) {
    return heading;
  }

  return path.basename(absolutePath, path.extname(absolutePath));
}

/**
 * Write markdown content and frontmatter to a local file.
 *
 * Creates parent directories as needed.
 *
 * @param filePath - Destination path.
 * @param content - Markdown body.
 * @param data - Frontmatter key-value pairs to serialise.
 */
async function writeMarkdownFile(filePath: string, content: string, data: Record<string, unknown>) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, matter.stringify(content, data), 'utf8');
}

/**
 * Update a page's title property if possible, returning the updated page.
 *
 * Silently returns the existing page when no title property can be found.
 *
 * @param notion - Authenticated Notion client.
 * @param pageId - UUID of the page to update.
 * @param title - New title text.
 * @returns The updated (or unchanged) page object.
 */
async function updatePageTitleIfPossible(
  notion: Client,
  pageId: string,
  title: string
): Promise<AnyPage> {
  const page = await retrievePageMetadata(notion, pageId);
  const titleProperty = findTitlePropertyName(page.properties);
  if (!titleProperty) {
    return page;
  }

  return notion.pages.update({
    page_id: pageId,
    properties: {
      [titleProperty]: {
        title: [{ type: 'text', text: { content: title } }],
      },
    },
  }) as Promise<AnyPage>;
}

/**
 * Determine the sync direction when the user chose "auto".
 *
 * @returns An object with `chosenDirection` ("push" | "pull") and `reason`.
 * @throws {Error} When auto cannot resolve (no page ID and no parent ID).
 */
function resolveSyncDirection(
  requestedDirection: SyncParams['direction'],
  localState: LocalFileState,
  remotePage: AnyPage | null,
  hasPageId: boolean,
  hasParentId: boolean
) {
  const direction = requestedDirection ?? 'auto';
  if (!['push', 'pull', 'auto'].includes(direction)) {
    throw new Error(`Invalid sync direction: ${direction}`);
  }

  if (direction !== 'auto') {
    return { chosenDirection: direction, reason: 'explicit direction' };
  }
  if (!hasPageId) {
    if (!hasParentId) {
      throw new Error(
        'Auto sync needs either page_id or notion_id to pull, or parent_id to create a new page.'
      );
    }
    return {
      chosenDirection: 'push' as const,
      reason: 'no page_id available, creating or updating from local file',
    };
  }
  if (!localState.exists) {
    return {
      chosenDirection: 'pull' as const,
      reason: 'local file missing, pulling from Notion',
    };
  }
  if (!remotePage) {
    return {
      chosenDirection: 'push' as const,
      reason: 'remote page missing, pushing local state',
    };
  }

  const localMtime = localState.stat?.mtimeMs ?? 0;
  const remoteMtime = Date.parse(remotePage.last_edited_time);
  return remoteMtime > localMtime
    ? { chosenDirection: 'pull' as const, reason: 'remote page is newer' }
    : { chosenDirection: 'push' as const, reason: 'local file is newer' };
}

/**
 * Push local file contents to Notion (create or update).
 *
 * After writing, stamps `notion_id` into the local frontmatter for
 * subsequent round-trip syncs.
 *
 * @returns The final page object and refreshed local mtime.
 * @throws {Error} When the local file does not exist or no parent is given for creation.
 */
async function pushLocalFile(
  notion: Client,
  localState: LocalFileState,
  pageId: string | undefined,
  parentId: string | undefined
) {
  if (!localState.exists) {
    throw new Error(`Local file not found: ${localState.absolutePath}`);
  }

  const title = inferMarkdownTitle(localState.content, localState.absolutePath, localState.data);
  let finalPage: AnyPage;

  if (!pageId) {
    if (!parentId) {
      throw new Error('Creating a new Notion page requires parent_id.');
    }
    finalPage = (await notion.pages.create({
      parent: { page_id: parentId },
      properties: {
        title: {
          title: [{ type: 'text', text: { content: title } }],
        },
      },
      markdown: localState.content,
    })) as AnyPage;
  } else {
    await getMarkdownPagesApi(notion).updateMarkdown({
      page_id: pageId,
      type: 'replace_content',
      replace_content: { new_str: localState.content },
    });
    finalPage = await updatePageTitleIfPossible(notion, pageId, title);
  }

  // Stamp notion_id back into local frontmatter.
  const updatedData = { ...localState.data, notion_id: finalPage.id };
  await writeMarkdownFile(localState.absolutePath, localState.content, updatedData);
  const refreshedStat = await fsp.stat(localState.absolutePath);

  return {
    page: finalPage,
    localMtime: refreshedStat.mtime.toISOString(),
  };
}

/**
 * Pull a Notion page's content into a local markdown file.
 *
 * @returns The page object and refreshed local mtime.
 */
async function pullRemotePage(
  notion: Client,
  localState: LocalFileState,
  pageId: string,
  remotePage: AnyPage | null
) {
  const markdownPage = await getMarkdownPagesApi(notion).retrieveMarkdown({ page_id: pageId });
  const page = remotePage ?? (await retrievePageMetadata(notion, pageId));
  const mergedData = {
    ...localState.data,
    notion_id: page.id,
    title: extractPageTitle(page),
  };
  await writeMarkdownFile(localState.absolutePath, String(markdownPage.markdown ?? ''), mergedData);
  const refreshedStat = await fsp.stat(localState.absolutePath);

  return {
    page,
    localMtime: refreshedStat.mtime.toISOString(),
  };
}

/**
 * Sync a local markdown file with a Notion page.
 *
 * @param notion - Authenticated Notion client.
 * @param params - Sync parameters (path, page_id, parent_id, direction).
 * @returns Sync result including direction chosen, reason, page URL, and timestamps.
 * @throws {Error} On invalid direction or insufficient identifiers for pull.
 */
export async function syncNotionFile(notion: Client, params: SyncParams) {
  const localState = await readLocalFileState(params.path);
  const frontmatterPageId =
    typeof localState.data.notion_id === 'string' && localState.data.notion_id.trim()
      ? localState.data.notion_id.trim()
      : undefined;
  const pageId = params.page_id ?? frontmatterPageId;
  const remotePage = pageId ? await retrievePageMetadata(notion, pageId) : null;

  const { chosenDirection, reason } = resolveSyncDirection(
    params.direction,
    localState,
    remotePage,
    Boolean(pageId),
    Boolean(params.parent_id)
  );

  if (chosenDirection === 'push') {
    const { page, localMtime } = await pushLocalFile(notion, localState, pageId, params.parent_id);
    return {
      direction: chosenDirection,
      reason,
      path: localState.absolutePath,
      page_id: page.id,
      url: page.url ?? null,
      local_mtime: localMtime,
      notion_last_edited_time: page.last_edited_time,
    };
  }

  if (!pageId) {
    throw new Error('Pull sync requires page_id or notion_id in frontmatter.');
  }

  const { page, localMtime } = await pullRemotePage(notion, localState, pageId, remotePage);
  return {
    direction: chosenDirection,
    reason,
    path: localState.absolutePath,
    page_id: page.id,
    url: page.url ?? null,
    local_mtime: localMtime,
    notion_last_edited_time: page.last_edited_time,
  };
}
