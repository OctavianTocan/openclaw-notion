import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import { Client } from "@notionhq/client";
import matter from "gray-matter";
import * as fs from "node:fs";
import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getNotionApiKey } from "./auth.js";

const NOTION_VERSION = "2026-03-11";
const DEFAULT_PAGE_SIZE = 100;
const KNOWN_AGENT_IDS = ["default", "gf_agent"] as const;

/**
 * The Notion SDK returns discriminated unions like `FullPageObjectResponse | PartialPageObjectResponse`.
 * PartialPageObjectResponse lacks url, properties, last_edited_time, etc.
 * In practice the API always returns full objects for our use cases.
 * We cast through `any` to access those fields safely, with null fallbacks.
 */
type AnyPage = any;
type AnyDatabase = any;
type AnyBlock = any;

type JsonContent = {
  content: Array<{ type: "text"; text: string }>;
  details: null;
};

type QueryParams = {
  database_id: string;
  filter?: string;
  sorts?: string;
  page_size?: number;
};

type DeleteParams = { page_id: string };

type MoveParams = {
  page_id: string;
  new_parent_id: string;
};

type PublishParams = {
  page_id: string;
  published?: boolean;
};

type FileTreeParams = {
  page_id: string;
  max_depth?: number;
};

type SyncParams = {
  path: string;
  page_id?: string;
  parent_id?: string;
  direction?: "push" | "pull" | "auto";
};

type HelpParams = { tool_name?: string };

type TreeNode = {
  title: string;
  id: string;
  url: string | null;
  type: "page" | "database";
  children: TreeNode[];
};

type ToolDoc = {
  name: string;
  description: string;
  parameters: string[];
  example: string;
};

type LocalFileState = {
  absolutePath: string;
  exists: boolean;
  data: Record<string, unknown>;
  content: string;
  stat: fs.Stats | null;
};

const clients = new Map<string, Client>();

const TOOL_DOCS: ToolDoc[] = [
  {
    name: "notion_search",
    description: "Search the Notion workspace for pages or databases.",
    parameters: ["query: string"],
    example: '{"query":"Projects"}',
  },
  {
    name: "notion_read",
    description: "Read raw block children for a page.",
    parameters: ["page_id: string"],
    example: '{"page_id":"<page-id>"}',
  },
  {
    name: "notion_append",
    description: "Append a text paragraph to a page.",
    parameters: ["page_id: string", "text: string"],
    example: '{"page_id":"<page-id>","text":"hello"}',
  },
  {
    name: "notion_create",
    description: "Create a page under a parent page using markdown.",
    parameters: ["parent_id: string", "markdown: string", "title?: string"],
    example:
      '{"parent_id":"<page-id>","title":"Draft","markdown":"# Hello"}',
  },
  {
    name: "notion_read_markdown",
    description: "Read a page as markdown.",
    parameters: ["page_id: string"],
    example: '{"page_id":"<page-id>"}',
  },
  {
    name: "notion_update_markdown",
    description: "Replace a page's content with markdown.",
    parameters: ["page_id: string", "content: string"],
    example: '{"page_id":"<page-id>","content":"# Updated"}',
  },
  {
    name: "notion_update_page",
    description: "Update a page title and/or icon.",
    parameters: ["page_id: string", "title?: string", "icon_emoji?: string"],
    example: '{"page_id":"<page-id>","title":"Renamed","icon_emoji":"🧪"}',
  },
  {
    name: "notion_comment_create",
    description: "Create a page comment.",
    parameters: ["page_id: string", "text: string"],
    example: '{"page_id":"<page-id>","text":"Ship it"}',
  },
  {
    name: "notion_comment_list",
    description: "List comments for a page.",
    parameters: ["page_id: string"],
    example: '{"page_id":"<page-id>"}',
  },
  {
    name: "notion_query",
    description: "Query a database or data source with optional filter and sorts JSON.",
    parameters: [
      "database_id: string",
      "filter?: JSON string",
      "sorts?: JSON string",
      `page_size?: number (default ${DEFAULT_PAGE_SIZE})`,
    ],
    example:
      '{"database_id":"<database-id>","sorts":"[{\\"timestamp\\":\\"last_edited_time\\",\\"direction\\":\\"descending\\"}]"}',
  },
  {
    name: "notion_delete",
    description: "Move a page to trash.",
    parameters: ["page_id: string"],
    example: '{"page_id":"<page-id>"}',
  },
  {
    name: "notion_move",
    description: "Move a page under another page.",
    parameters: ["page_id: string", "new_parent_id: string"],
    example: '{"page_id":"<page-id>","new_parent_id":"<parent-id>"}',
  },
  {
    name: "notion_publish",
    description:
      "Attempt to toggle public sharing. Returns a limitation report when the API cannot do it.",
    parameters: ["page_id: string", "published?: boolean (default true)"],
    example: '{"page_id":"<page-id>","published":true}',
  },
  {
    name: "notion_file_tree",
    description: "Recursively enumerate child pages and child databases.",
    parameters: ["page_id: string", "max_depth?: number (default 3)"],
    example: '{"page_id":"<page-id>","max_depth":2}',
  },
  {
    name: "notion_sync",
    description:
      "Sync a markdown file and a Notion page. Uses YAML frontmatter notion_id when present.",
    parameters: [
      "path: string",
      "page_id?: string",
      "parent_id?: string",
      'direction?: "push" | "pull" | "auto" (default auto)',
    ],
    example:
      '{"path":"./notes/todo.md","parent_id":"<page-id>","direction":"auto"}',
  },
  {
    name: "notion_help",
    description: "Return static documentation for Notion tools.",
    parameters: ["tool_name?: string"],
    example: '{"tool_name":"notion_sync"}',
  },
  {
    name: "notion_doctor",
    description: "Run read-only diagnostics for API keys, SDK version, and connectivity.",
    parameters: [],
    example: "{}",
  },
];

function getClient(agentId?: string): Client {
  const cacheKey = agentId || "default";
  if (!clients.has(cacheKey)) {
    clients.set(
      cacheKey,
      new Client({
        auth: getNotionApiKey(agentId),
        notionVersion: NOTION_VERSION,
      })
    );
  }
  return clients.get(cacheKey)!;
}

function asJsonContent(value: unknown): JsonContent {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    details: null,
  };
}

function asTextContent(text: string): JsonContent {
  return {
    content: [{ type: "text", text }],
    details: null,
  };
}

function parseJsonInput<T>(raw: string | undefined, fieldName: string): T | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${fieldName} JSON: ${message}`);
  }
}

function getPackageMetadata() {
  const pluginPackage = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
  ) as { version?: string; name?: string };
  const sdkPackage = JSON.parse(
    fs.readFileSync(
      new URL("../node_modules/@notionhq/client/package.json", import.meta.url),
      "utf8"
    )
  ) as { version?: string };
  return {
    pluginName: pluginPackage.name ?? "openclaw-notion",
    pluginVersion: pluginPackage.version ?? "unknown",
    sdkVersion: sdkPackage.version ?? "unknown",
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function extractPlainText(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const text = value
    .map((item) => (isRecord(item) && typeof item.plain_text === "string" ? item.plain_text : ""))
    .join("")
    .trim();
  return text || null;
}

function findTitlePropertyName(properties: unknown): string | null {
  if (!isRecord(properties)) {
    return null;
  }
  for (const [name, value] of Object.entries(properties)) {
    if (isRecord(value) && value.type === "title") {
      return name;
    }
  }
  return null;
}

function extractPageTitle(page: unknown): string {
  if (!isRecord(page)) {
    return "Untitled";
  }
  if (Array.isArray(page.title)) {
    return extractPlainText(page.title) ?? "Untitled";
  }
  const titleProperty = findTitlePropertyName(page.properties);
  if (titleProperty && isRecord(page.properties) && isRecord(page.properties[titleProperty])) {
    const propertyValue = page.properties[titleProperty];
    return extractPlainText(propertyValue.title) ?? "Untitled";
  }
  return "Untitled";
}

function wrapPageResponse(response: any) {
  return {
    url: response.url ?? null,
    response,
  };
}

function shouldFallbackQuery(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  const code = typeof error.code === "string" ? error.code : "";
  return code === "object_not_found" || code === "validation_error";
}

async function retrievePageMetadata(notion: Client, pageId: string): Promise<AnyPage> {
  return notion.pages.retrieve({ page_id: pageId }) as Promise<AnyPage>;
}

async function retrieveDatabaseMetadata(
  notion: Client,
  databaseId: string
): Promise<AnyDatabase> {
  return notion.databases.retrieve({ database_id: databaseId }) as Promise<AnyDatabase>;
}

export async function queryNotionDatabase(notion: Client, params: QueryParams) {
  const pageSize = params.page_size ?? DEFAULT_PAGE_SIZE;
  const filter = parseJsonInput<Record<string, unknown>>(params.filter, "filter");
  const sorts = parseJsonInput<Array<Record<string, unknown>>>(params.sorts, "sorts");

  // The SDK types lag the runtime — databases.query may not be typed,
  // and filter/sorts unions are too narrow for user-supplied JSON.
  // We cast through `any` and let the API validate at runtime.
  const queryFn = (notion as any).databases?.query?.bind(notion.databases);
  const dataSourceFn = (notion as any).dataSources?.query?.bind((notion as any).dataSources);

  const mapResults = (results: any[]) =>
    results.map((entry: any) => ({
      id: entry.id,
      object: entry.object,
      url: entry.url ?? null,
      properties: entry.properties ?? null,
    }));

  if (queryFn) {
    try {
      const response = await queryFn({
        database_id: params.database_id,
        filter,
        sorts,
        page_size: pageSize,
      });
      return {
        mode: "database",
        database_id: params.database_id,
        page_size: pageSize,
        has_more: response.has_more,
        next_cursor: response.next_cursor,
        results: mapResults(response.results),
      };
    } catch (error) {
      if (!dataSourceFn || !shouldFallbackQuery(error)) {
        throw error;
      }
    }
  }

  if (!dataSourceFn) {
    throw new Error("Neither databases.query nor dataSources.query is available in the SDK.");
  }

  const response = await dataSourceFn({
    data_source_id: params.database_id,
    filter,
    sorts,
    page_size: pageSize,
  });
  return {
    mode: "data_source",
    database_id: params.database_id,
    page_size: pageSize,
    has_more: response.has_more,
    next_cursor: response.next_cursor,
    results: mapResults(response.results),
  };
}

export async function deleteNotionPage(notion: Client, params: DeleteParams) {
  return notion.pages.update({ page_id: params.page_id, in_trash: true });
}

export async function moveNotionPage(notion: Client, params: MoveParams) {
  if (typeof notion.pages.move === "function") {
    return notion.pages.move({
      page_id: params.page_id,
      parent: { page_id: params.new_parent_id },
    });
  }

  return notion.request({
    path: `pages/${params.page_id}/move`,
    method: "post",
    body: { parent: { page_id: params.new_parent_id } },
  });
}

export async function publishNotionPage(notion: Client, params: PublishParams) {
  const page = await notion.pages.retrieve({ page_id: params.page_id }) as AnyPage;
  return {
    supported: false,
    page_id: params.page_id,
    requested_state: params.published ?? true,
    url: page.url ?? null,
    public_url: page.public_url ?? null,
    message:
      "Notion's public sharing toggle is not exposed by the SDK or update endpoints available to this plugin. The tool is a read-only stub until the API supports publish or unpublish.",
  };
}

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
      const b = block as AnyBlock;
      if (b.type === "child_page") {
        node.children.push(await buildFileTreeNode(notion, b.id, maxDepth, depth + 1));
      } else if (b.type === "child_database") {
        const database = await retrieveDatabaseMetadata(notion, b.id);
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

async function readLocalFileState(filePath: string): Promise<LocalFileState> {
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

function inferMarkdownTitle(content: string, absolutePath: string, data: Record<string, unknown>) {
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

async function writeMarkdownFile(
  filePath: string,
  content: string,
  data: Record<string, unknown>
) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const serialized = matter.stringify(content, data);
  await fsp.writeFile(filePath, serialized, "utf8");
}

async function updatePageTitleIfPossible(notion: Client, pageId: string, title: string): Promise<AnyPage> {
  const page: AnyPage = await retrievePageMetadata(notion, pageId);
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

export async function syncNotionFile(notion: Client, params: SyncParams) {
  const direction = params.direction ?? "auto";
  if (!["push", "pull", "auto"].includes(direction)) {
    throw new Error(`Invalid sync direction: ${direction}`);
  }

  const local = await readLocalFileState(params.path);
  const frontmatterPageId =
    typeof local.data.notion_id === "string" && local.data.notion_id.trim()
      ? local.data.notion_id.trim()
      : undefined;
  const pageId = params.page_id ?? frontmatterPageId;

  let remotePage: AnyPage | null = null;
  if (pageId) {
    remotePage = await retrievePageMetadata(notion, pageId);
  }

  let chosenDirection = direction;
  let reason = "explicit direction";

  if (direction === "auto") {
    if (!pageId) {
      if (!params.parent_id) {
        throw new Error(
          "Auto sync needs either page_id or notion_id to pull, or parent_id to create a new page."
        );
      }
      chosenDirection = "push";
      reason = "no page_id available, creating or updating from local file";
    } else if (!local.exists) {
      chosenDirection = "pull";
      reason = "local file missing, pulling from Notion";
    } else if (!remotePage) {
      chosenDirection = "push";
      reason = "remote page missing, pushing local state";
    } else {
      const localMtime = local.stat?.mtimeMs ?? 0;
      const remoteMtime = Date.parse(remotePage.last_edited_time);
      chosenDirection = remoteMtime > localMtime ? "pull" : "push";
      reason = remoteMtime > localMtime ? "remote page is newer" : "local file is newer";
    }
  }

  if (chosenDirection === "push") {
    if (!local.exists) {
      throw new Error(`Local file not found: ${local.absolutePath}`);
    }

    const title = inferMarkdownTitle(local.content, local.absolutePath, local.data);
    let finalPage: AnyPage = remotePage;

    if (!pageId) {
      if (!params.parent_id) {
        throw new Error("Creating a new Notion page requires parent_id.");
      }
      finalPage = await notion.pages.create({
        parent: { page_id: params.parent_id },
        properties: {
          title: {
            title: [{ type: "text", text: { content: title } }],
          },
        },
        markdown: local.content,
      }) as AnyPage;
    } else {
      await (notion.pages as any).updateMarkdown({
        page_id: pageId,
        type: "replace_content",
        replace_content: { new_str: local.content },
      });
      finalPage = await updatePageTitleIfPossible(notion, pageId, title);
    }

    const updatedData = { ...local.data, notion_id: finalPage.id };
    await writeMarkdownFile(local.absolutePath, local.content, updatedData);
    const refreshedStat = await fsp.stat(local.absolutePath);

    return {
      direction: chosenDirection,
      reason,
      path: local.absolutePath,
      page_id: finalPage.id,
      url: finalPage.url ?? null,
      local_mtime: refreshedStat.mtime.toISOString(),
      notion_last_edited_time: finalPage.last_edited_time,
    };
  }

  if (!pageId) {
    throw new Error("Pull sync requires page_id or notion_id in frontmatter.");
  }

  const markdownPage = await (notion.pages as any).retrieveMarkdown({ page_id: pageId });
  const page: AnyPage = remotePage ?? (await retrievePageMetadata(notion, pageId));
  const mergedData = {
    ...local.data,
    notion_id: page.id,
    title: extractPageTitle(page),
  };
  await writeMarkdownFile(local.absolutePath, markdownPage.markdown, mergedData);
  const refreshedStat = await fsp.stat(local.absolutePath);

  return {
    direction: chosenDirection,
    reason,
    path: local.absolutePath,
    page_id: page.id,
    url: page.url ?? null,
    local_mtime: refreshedStat.mtime.toISOString(),
    notion_last_edited_time: page.last_edited_time,
  };
}

export function getNotionHelp(toolName?: string) {
  const docs = toolName
    ? TOOL_DOCS.filter((tool) => tool.name === toolName)
    : TOOL_DOCS;
  if (toolName && docs.length === 0) {
    throw new Error(`Unknown Notion tool: ${toolName}`);
  }
  return docs
    .map(
      (tool) =>
        `${tool.name}\n${tool.description}\nParameters: ${tool.parameters.join(", ")}\nExample: ${tool.example}`
    )
    .join("\n\n");
}

function listConfiguredAgents() {
  const configDir = path.join(os.homedir(), ".config", "notion");
  const discovered = new Set<string>(KNOWN_AGENT_IDS);
  try {
    for (const entry of fs.readdirSync(configDir)) {
      if (entry === "api_key") {
        discovered.add("default");
      } else if (entry.startsWith("api_key_")) {
        discovered.add(entry.replace(/^api_key_/, ""));
      }
    }
  } catch {
    discovered.add("default");
  }
  return [...discovered];
}

export async function runNotionDoctor(currentAgentId?: string) {
  const { pluginName, pluginVersion, sdkVersion } = getPackageMetadata();
  const agentIds = listConfiguredAgents();
  const agentReports = await Promise.all(
    agentIds.map(async (agentId) => {
      const resolvedAgentId = agentId === "default" ? undefined : agentId;
      try {
        const apiKey = getNotionApiKey(resolvedAgentId);
        const notion = getClient(resolvedAgentId);
        const response = await notion.search({ query: "", page_size: 1 });
        return {
          agent_id: agentId,
          using_current_context: (currentAgentId ?? "default") === agentId,
          api_key_present: true,
          api_key_prefix: apiKey.slice(0, 6),
          connectivity: {
            ok: true,
            result_count: response.results.length,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          agent_id: agentId,
          using_current_context: (currentAgentId ?? "default") === agentId,
          api_key_present: false,
          connectivity: {
            ok: false,
            error: message,
          },
        };
      }
    })
  );

  return {
    plugin: {
      name: pluginName,
      version: pluginVersion,
      notion_version: NOTION_VERSION,
      sdk_version: sdkVersion,
    },
    current_agent: currentAgentId ?? "default",
    configured_agents: agentReports,
  };
}

export default definePluginEntry({
  id: "notion",
  name: "Notion",
  description:
    "Notion API for creating and managing pages, databases, and blocks.",
  register(api) {
    api.registerTool((ctx) => ({
      name: "notion_search",
      label: "Notion Search",
      description:
        "Search the Notion workspace for pages or databases. Returns matching items with their IDs.",
      parameters: Type.Object({
        query: Type.String({
          description:
            "The text to search for across page titles and contents.",
        }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await notion.search({
          query: params.query,
          page_size: 10,
        });
        return asJsonContent(response.results);
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_read",
      label: "Notion Read",
      description:
        "Read the raw block contents of a Notion page using its UUID.",
      parameters: Type.Object({
        page_id: Type.String({
          description: "The UUID of the Notion page to read.",
        }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await notion.blocks.children.list({
          block_id: params.page_id,
        });
        return asJsonContent(response.results);
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_append",
      label: "Notion Append",
      description:
        "Append a simple text paragraph block to the bottom of a Notion page.",
      parameters: Type.Object({
        page_id: Type.String({
          description: "The UUID of the target Notion page.",
        }),
        text: Type.String({
          description: "The plain text content to append.",
        }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await notion.blocks.children.append({
          block_id: params.page_id,
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  {
                    type: "text",
                    text: { content: params.text },
                  },
                ],
              },
            },
          ],
        });
        return asJsonContent(response.results);
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_create",
      label: "Notion Create",
      description: "Create a Notion page under a parent page using markdown.",
      parameters: Type.Object({
        parent_id: Type.String({
          description: "The UUID of the parent Notion page.",
        }),
        markdown: Type.String({
          description: "The page body as markdown.",
        }),
        title: Type.Optional(
          Type.String({
            description: "Optional page title.",
          })
        ),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await notion.pages.create({
          parent: { page_id: params.parent_id },
          properties: params.title
            ? {
                title: {
                  title: [{ type: "text", text: { content: params.title } }],
                },
              }
            : undefined,
          markdown: params.markdown,
        }) as AnyPage;
        return asJsonContent(wrapPageResponse(response));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_read_markdown",
      label: "Notion Read Markdown",
      description: "Read a Notion page as markdown.",
      parameters: Type.Object({
        page_id: Type.String({
          description: "The UUID of the Notion page to read.",
        }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await (notion.pages as any).retrieveMarkdown({
          page_id: params.page_id,
        });
        return asJsonContent(response);
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_update_markdown",
      label: "Notion Update Markdown",
      description: "Replace the content of a Notion page with markdown.",
      parameters: Type.Object({
        page_id: Type.String({
          description: "The UUID of the Notion page to update.",
        }),
        content: Type.String({
          description: "The new markdown content for the page.",
        }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await (notion.pages as any).updateMarkdown({
          page_id: params.page_id,
          type: "replace_content",
          replace_content: { new_str: params.content },
        });
        const page = await notion.pages.retrieve({ page_id: params.page_id }) as AnyPage;
        return asJsonContent({ url: page.url ?? null, response });
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_update_page",
      label: "Notion Update Page",
      description: "Update a Notion page title and/or icon.",
      parameters: Type.Object({
        page_id: Type.String({
          description: "The UUID of the Notion page to update.",
        }),
        title: Type.Optional(
          Type.String({
            description: "Optional new page title.",
          })
        ),
        icon_emoji: Type.Optional(
          Type.String({
            description: "Optional emoji icon for the page.",
          })
        ),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const currentPage = await notion.pages.retrieve({ page_id: params.page_id }) as AnyPage;
        const titleProperty = findTitlePropertyName(currentPage.properties) ?? "title";
        const response = await notion.pages.update({
          page_id: params.page_id,
          icon: params.icon_emoji
            ? { type: "emoji", emoji: params.icon_emoji }
            : undefined,
          properties: params.title
            ? {
                [titleProperty]: {
                  title: [{ type: "text", text: { content: params.title } }],
                },
              }
            : undefined,
        });
        return asJsonContent(wrapPageResponse(response));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_comment_create",
      label: "Notion Comment Create",
      description: "Create a comment on a Notion page.",
      parameters: Type.Object({
        page_id: Type.String({
          description: "The UUID of the Notion page to comment on.",
        }),
        text: Type.String({
          description: "The comment text.",
        }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await notion.comments.create({
          parent: { page_id: params.page_id },
          rich_text: [{ type: "text", text: { content: params.text } }],
        });
        return asJsonContent(response);
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_comment_list",
      label: "Notion Comment List",
      description: "List comments attached to a Notion page.",
      parameters: Type.Object({
        page_id: Type.String({
          description: "The UUID of the Notion page whose comments to list.",
        }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        const response = await notion.comments.list({
          block_id: params.page_id,
        });
        return asJsonContent(response.results);
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_query",
      label: "Notion Query",
      description:
        "Query a Notion database or data source with optional filter and sort JSON.",
      parameters: Type.Object({
        database_id: Type.String({ description: "Database or data source ID." }),
        filter: Type.Optional(
          Type.String({ description: "Optional filter JSON string." })
        ),
        sorts: Type.Optional(
          Type.String({ description: "Optional sorts JSON string." })
        ),
        page_size: Type.Optional(
          Type.Number({ description: `Optional page size, defaults to ${DEFAULT_PAGE_SIZE}.` })
        ),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        return asJsonContent(await queryNotionDatabase(notion, params));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_delete",
      label: "Notion Delete",
      description: "Move a Notion page to trash.",
      parameters: Type.Object({
        page_id: Type.String({ description: "Page ID to trash." }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        return asJsonContent(await deleteNotionPage(notion, params));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_move",
      label: "Notion Move",
      description: "Move a page under a new parent page.",
      parameters: Type.Object({
        page_id: Type.String({ description: "Page ID to move." }),
        new_parent_id: Type.String({ description: "Destination parent page ID." }),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        return asJsonContent(await moveNotionPage(notion, params));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_publish",
      label: "Notion Publish",
      description:
        "Attempt to toggle public sharing. Returns an explanatory stub if the Notion API does not support it.",
      parameters: Type.Object({
        page_id: Type.String({ description: "Page ID to publish or unpublish." }),
        published: Type.Optional(
          Type.Boolean({ description: "Desired public state, defaults to true." })
        ),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        return asJsonContent(await publishNotionPage(notion, params));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_file_tree",
      label: "Notion File Tree",
      description: "Recursively enumerate child pages and child databases.",
      parameters: Type.Object({
        page_id: Type.String({ description: "Root page ID." }),
        max_depth: Type.Optional(
          Type.Number({ description: "Maximum recursion depth, defaults to 3." })
        ),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        return asJsonContent(await getNotionFileTree(notion, params));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_sync",
      label: "Notion Sync",
      description:
        "Sync a local markdown file with a Notion page using push, pull, or auto mode.",
      parameters: Type.Object({
        path: Type.String({ description: "Local filesystem path." }),
        page_id: Type.Optional(Type.String({ description: "Optional Notion page ID." })),
        parent_id: Type.Optional(
          Type.String({ description: "Parent page ID when creating a new page." })
        ),
        direction: Type.Optional(
          Type.String({ description: 'push, pull, or auto. Defaults to "auto".' })
        ),
      }),
      async execute(_id, params) {
        const notion = getClient(ctx.agentId);
        return asJsonContent(await syncNotionFile(notion, params as SyncParams));
      },
    }));

    api.registerTool(() => ({
      name: "notion_help",
      label: "Notion Help",
      description: "Return static documentation for all Notion tools.",
      parameters: Type.Object({
        tool_name: Type.Optional(Type.String({ description: "Optional tool name." })),
      }),
      async execute(_id, params) {
        return asTextContent(getNotionHelp(params.tool_name));
      },
    }));

    api.registerTool((ctx) => ({
      name: "notion_doctor",
      label: "Notion Doctor",
      description: "Run read-only diagnostics for Notion plugin setup.",
      parameters: Type.Object({}),
      async execute() {
        return asJsonContent(await runNotionDoctor(ctx.agentId));
      },
    }));
  },
});
