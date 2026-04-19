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
import { getMarkdownPagesApi } from '../client.js';
import { DEFAULT_PAGE_SIZE } from '../constants.js';
import {
  extractPageTitle,
  findTitlePropertyName,
  isRecord,
  retrievePageMetadata,
} from '../helpers.js';
import type { AnyBlock, AnyPage, LocalFileState, SyncParams } from '../types.js';

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
 * When updating, wraps the Notion API error with the page ID and a hint
 * about the child-page safety check so failures are diagnosable.
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
    try {
      await getMarkdownPagesApi(notion).updateMarkdown({
        page_id: pageId,
        type: 'replace_content',
        replace_content: { new_str: localState.content },
      });
    } catch (error) {
      // Surface Notion's error details so the caller can diagnose the failure.
      // The API returns structured errors for child-page safety violations and
      // block creation failures, but the SDK wraps them in generic errors.
      const detail = extractNotionErrorDetail(error);
      throw new Error(
        `Failed to push content to page ${pageId}: ${detail}\n` +
          `Hint: if the page has child pages or databases, ensure the local file ` +
          `contains <page url="...">Title</page> tags for each child. ` +
          `Pull the page first to get the correct references.`
      );
    }
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
 * Extract a human-readable error message from a Notion SDK error.
 *
 * The SDK wraps API errors in objects with `body`, `message`, `code`, and
 * `status` properties. This helper digs through those layers so push failures
 * include the server's actual complaint (e.g. which child pages would be
 * deleted, or which block failed to create).
 *
 * @param error - Caught error from a Notion SDK call.
 * @returns A descriptive error string.
 */
function extractNotionErrorDetail(error: unknown): string {
  if (!isRecord(error)) return String(error);

  // The SDK typically puts the API message on error.message and the full body
  // on error.body (a string or object).
  const parts: string[] = [];

  if (typeof error.message === 'string') {
    parts.push(error.message);
  }
  if (typeof error.code === 'string') {
    parts.push(`[${error.code}]`);
  }
  if (typeof error.body === 'string') {
    parts.push(error.body);
  } else if (isRecord(error.body) && typeof error.body.message === 'string') {
    parts.push(error.body.message);
  }

  return parts.length > 0 ? parts.join(' — ') : String(error);
}

/**
 * Normalise underscore-delimited italics to asterisk-delimited italics.
 *
 * Notion's enhanced markdown format specifies `*text*` for italics, but some
 * content round-trips through `_text_` depending on the original source.
 * Normalising on pull prevents cosmetic diffs from accumulating across
 * pull-push cycles.
 *
 * Skips content inside code fences and inline code spans to avoid mangling
 * code samples.
 *
 * @param markdown - Raw markdown string from Notion.
 * @returns Markdown with underscore italics replaced by asterisk italics.
 */
function normalizeItalics(markdown: string): string {
  // Split on code fences and inline code so we only transform prose regions.
  // Fenced code blocks: ```...``` (greedy, multiline)
  // Inline code: `...` (non-greedy, single line)
  const codePattern = /(```[\s\S]*?```|`[^`]+`)/g;
  const parts = markdown.split(codePattern);

  for (let i = 0; i < parts.length; i++) {
    // Even indices are prose, odd indices are code (captured by the split regex).
    if (i % 2 === 0) {
      // Replace _word_ patterns that aren't inside a larger word (bounded by
      // non-word chars or start/end of string). Handles multi-word spans like
      // _some phrase here_ by matching across spaces.
      parts[i] = parts[i].replace(/(?<=^|[^\\a-zA-Z0-9])_([^\n_]+?)_(?=[^a-zA-Z0-9]|$)/g, '*$1*');
    }
  }

  return parts.join('');
}

/**
 * Enumerate child pages and databases for a Notion page.
 *
 * Walks the page's block children to find `child_page` and `child_database`
 * blocks. Returns an array of `{ id, title, type, url }` objects.
 *
 * @param notion - Authenticated Notion client.
 * @param pageId - UUID of the parent page.
 * @returns Array of child page/database descriptors.
 */
async function enumerateChildBlocks(
  notion: Client,
  pageId: string
): Promise<
  Array<{ id: string; title: string; type: 'child_page' | 'child_database'; url: string | null }>
> {
  const children: Array<{
    id: string;
    title: string;
    type: 'child_page' | 'child_database';
    url: string | null;
  }> = [];
  let startCursor: string | undefined;

  do {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: startCursor,
      page_size: DEFAULT_PAGE_SIZE,
    });

    for (const block of response.results) {
      const b = block as AnyBlock;
      if (b.type === 'child_page') {
        const childPage = b.child_page as { title?: string } | undefined;
        const title = childPage?.title ?? 'Untitled';
        const page = await retrievePageMetadata(notion, b.id);
        children.push({ id: b.id, title, type: 'child_page', url: page.url ?? null });
      } else if (b.type === 'child_database') {
        const childDb = b.child_database as { title?: string } | undefined;
        const title = childDb?.title ?? 'Untitled';
        children.push({ id: b.id, title, type: 'child_database', url: null });
      }
    }

    startCursor = response.next_cursor ?? undefined;
  } while (startCursor);

  return children;
}

/**
 * Append child page/database reference tags to pulled markdown.
 *
 * The Notion retrieveMarkdown endpoint may omit `<page>` tags for child pages
 * the integration can see through the block API but that aren't represented in
 * the enhanced markdown output. Appending these tags ensures the pulled content
 * is push-safe: pushing it back won't trigger Notion's child-page safety error.
 *
 * Only appends tags for children whose URLs don't already appear in the markdown.
 *
 * @param markdown - Enhanced markdown string from retrieveMarkdown.
 * @param children - Child blocks discovered via blocks.children.list.
 * @returns Markdown with any missing child reference tags appended.
 */
function appendMissingChildTags(
  markdown: string,
  children: Array<{
    id: string;
    title: string;
    type: 'child_page' | 'child_database';
    url: string | null;
  }>
): string {
  if (children.length === 0) return markdown;

  const missingTags: string[] = [];

  for (const child of children) {
    // Check if this child is already referenced in the markdown by its URL or ID.
    // The enhanced markdown format uses <page url="..."> or the ID might appear
    // in an <unknown> tag or inline reference.
    const idNoDashes = child.id.replace(/-/g, '');
    const alreadyReferenced =
      (child.url && markdown.includes(child.url)) ||
      markdown.includes(child.id) ||
      markdown.includes(idNoDashes);

    if (!alreadyReferenced) {
      if (child.type === 'child_page') {
        // Use Notion's enhanced markdown format for child page references.
        const url = child.url ?? `https://www.notion.so/${idNoDashes}`;
        missingTags.push(`<page url="${url}">${child.title}</page>`);
      } else {
        const url = `https://www.notion.so/${idNoDashes}`;
        missingTags.push(`<database url="${url}">${child.title}</database>`);
      }
    }
  }

  if (missingTags.length === 0) return markdown;

  // Append after a blank line so the tags don't merge with existing content.
  const separator = markdown.endsWith('\n') ? '\n' : '\n\n';
  return `${markdown}${separator}${missingTags.join('\n')}\n`;
}

/**
 * Pull a Notion page's content into a local markdown file.
 *
 * Discovers child pages/databases via the block API and appends reference tags
 * for any that the retrieveMarkdown endpoint omitted. Normalises italic syntax
 * to asterisks so pull-push round-trips don't generate cosmetic diffs.
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
  const rawMarkdown = markdownPage.markdown;
  if (typeof rawMarkdown !== 'string') {
    throw new Error('Expected markdownPage.markdown to be a string');
  }
  let markdown: string = rawMarkdown;

  // Discover child pages/databases and ensure they're referenced in the
  // markdown so a subsequent push won't trigger Notion's safety error.
  const children = await enumerateChildBlocks(notion, pageId);
  markdown = appendMissingChildTags(markdown, children);

  // Normalise underscore italics to asterisk italics to prevent cosmetic drift.
  markdown = normalizeItalics(markdown);

  await writeMarkdownFile(localState.absolutePath, markdown, mergedData);
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
  let remotePage: AnyPage | null = null;
  if (pageId) {
    try {
      remotePage = await retrievePageMetadata(notion, pageId);
    } catch {
      // Page may have been deleted or the ID may be stale.
      // Let resolveSyncDirection handle the missing-remote case.
      remotePage = null;
    }
  }

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
