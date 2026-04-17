import { promises as fsp } from "node:fs";
import * as path from "node:path";
import type { Client } from "@notionhq/client";
import matter from "gray-matter";
import {
  extractPageTitle,
  findTitlePropertyName,
  isRecord,
  retrievePageMetadata,
} from "../helpers.js";
import type { AnyPage, LocalFileState, MarkdownPageApi, SyncParams } from "../types.js";

const getMarkdownPagesApi = (notion: Client) => notion.pages as unknown as MarkdownPageApi;

export async function readLocalFileState(filePath: string): Promise<LocalFileState> {
  const absolutePath = path.resolve(filePath);
  try {
    const stat = await fsp.stat(absolutePath);
    const raw = await fsp.readFile(absolutePath, "utf8");
    const parsed = matter(raw);
    return {
      absolutePath,
      exists: true,
      data: isRecord(parsed.data) ? parsed.data : {},
      content: parsed.content,
      stat,
    };
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return {
        absolutePath,
        exists: false,
        data: {},
        content: "",
        stat: null,
      };
    }
    throw error;
  }
}

export function inferMarkdownTitle(
  content: string,
  absolutePath: string,
  data: Record<string, unknown>,
) {
  const frontmatterTitle = typeof data.title === "string" ? data.title.trim() : "";
  if (frontmatterTitle) {
    return frontmatterTitle;
  }

  const heading = content
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith("# "))
    ?.replace(/^#\s+/, "")
    .trim();
  if (heading) {
    return heading;
  }

  return path.basename(absolutePath, path.extname(absolutePath));
}

export async function writeMarkdownFile(
  filePath: string,
  content: string,
  data: Record<string, unknown>,
) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, matter.stringify(content, data), "utf8");
}

export async function updatePageTitleIfPossible(
  notion: Client,
  pageId: string,
  title: string,
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
        title: [{ type: "text", text: { content: title } }],
      },
    },
  }) as Promise<AnyPage>;
}

function resolveSyncDirection(
  requestedDirection: SyncParams["direction"],
  localState: LocalFileState,
  remotePage: AnyPage | null,
  hasPageId: boolean,
  hasParentId: boolean,
) {
  const direction = requestedDirection ?? "auto";
  if (!["push", "pull", "auto"].includes(direction)) {
    throw new Error(`Invalid sync direction: ${direction}`);
  }

  if (direction !== "auto") {
    return { chosenDirection: direction, reason: "explicit direction" };
  }
  if (!hasPageId) {
    if (!hasParentId) {
      throw new Error(
        "Auto sync needs either page_id or notion_id to pull, or parent_id to create a new page.",
      );
    }
    return {
      chosenDirection: "push" as const,
      reason: "no page_id available, creating or updating from local file",
    };
  }
  if (!localState.exists) {
    return {
      chosenDirection: "pull" as const,
      reason: "local file missing, pulling from Notion",
    };
  }
  if (!remotePage) {
    return {
      chosenDirection: "push" as const,
      reason: "remote page missing, pushing local state",
    };
  }

  const localMtime = localState.stat?.mtimeMs ?? 0;
  const remoteMtime = Date.parse(remotePage.last_edited_time);
  return remoteMtime > localMtime
    ? { chosenDirection: "pull" as const, reason: "remote page is newer" }
    : { chosenDirection: "push" as const, reason: "local file is newer" };
}

async function pushLocalFile(
  notion: Client,
  localState: LocalFileState,
  pageId: string | undefined,
  parentId: string | undefined,
  _remotePage: AnyPage | null,
) {
  if (!localState.exists) {
    throw new Error(`Local file not found: ${localState.absolutePath}`);
  }

  const title = inferMarkdownTitle(localState.content, localState.absolutePath, localState.data);
  let finalPage: AnyPage;

  if (!pageId) {
    if (!parentId) {
      throw new Error("Creating a new Notion page requires parent_id.");
    }
    finalPage = (await notion.pages.create({
      parent: { page_id: parentId },
      properties: {
        title: {
          title: [{ type: "text", text: { content: title } }],
        },
      },
      markdown: localState.content,
    })) as AnyPage;
  } else {
    await getMarkdownPagesApi(notion).updateMarkdown({
      page_id: pageId,
      type: "replace_content",
      replace_content: { new_str: localState.content },
    });
    finalPage = await updatePageTitleIfPossible(notion, pageId, title);
  }

  const updatedData = { ...localState.data, notion_id: finalPage.id };
  await writeMarkdownFile(localState.absolutePath, localState.content, updatedData);
  const refreshedStat = await fsp.stat(localState.absolutePath);

  return {
    page: finalPage,
    localMtime: refreshedStat.mtime.toISOString(),
  };
}

async function pullRemotePage(
  notion: Client,
  localState: LocalFileState,
  pageId: string,
  remotePage: AnyPage | null,
) {
  const markdownPage = await getMarkdownPagesApi(notion).retrieveMarkdown({ page_id: pageId });
  const page = remotePage ?? (await retrievePageMetadata(notion, pageId));
  const mergedData = {
    ...localState.data,
    notion_id: page.id,
    title: extractPageTitle(page),
  };
  await writeMarkdownFile(localState.absolutePath, String(markdownPage.markdown ?? ""), mergedData);
  const refreshedStat = await fsp.stat(localState.absolutePath);

  return {
    page,
    localMtime: refreshedStat.mtime.toISOString(),
  };
}

export async function syncNotionFile(notion: Client, params: SyncParams) {
  const localState = await readLocalFileState(params.path);
  const frontmatterPageId =
    typeof localState.data.notion_id === "string" && localState.data.notion_id.trim()
      ? localState.data.notion_id.trim()
      : undefined;
  const pageId = params.page_id ?? frontmatterPageId;
  const remotePage = pageId ? await retrievePageMetadata(notion, pageId) : null;

  const { chosenDirection, reason } = resolveSyncDirection(
    params.direction,
    localState,
    remotePage,
    Boolean(pageId),
    Boolean(params.parent_id),
  );

  if (chosenDirection === "push") {
    const { page, localMtime } = await pushLocalFile(
      notion,
      localState,
      pageId,
      params.parent_id,
      remotePage,
    );
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
    throw new Error("Pull sync requires page_id or notion_id in frontmatter.");
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
