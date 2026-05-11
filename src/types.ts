/**
 * Shared type definitions for the openclaw-notion plugin.
 *
 * The Notion SDK returns discriminated unions like
 * `FullPageObjectResponse | PartialPageObjectResponse`. The partial variant
 * lacks url, properties, last_edited_time, etc. In practice the API always
 * returns full objects for our use-cases, so we define loose structural types
 * with `any`-backed index signatures and null-safe field access throughout.
 */

import type { Stats } from 'node:fs';

/** Generic record type used wherever the Notion SDK returns untyped objects. */
export type LooseRecord = Record<string, unknown>;

/** Loosely-typed Notion page with the fields we actually read. */
export type AnyPage = LooseRecord & {
  id: string;
  url?: string | null;
  public_url?: string | null;
  last_edited_time: string;
  properties?: LooseRecord;
  title?: unknown[];
  parent?: { page_id?: string };
  object?: string;
  icon?: LooseRecord | null;
  in_trash?: boolean;
  archived?: boolean;
};

/** Loosely-typed Notion database metadata. */
export type AnyDatabase = LooseRecord & {
  id: string;
  url?: string | null;
  properties?: LooseRecord;
  title?: unknown[];
};

/** Loosely-typed Notion block. */
export type AnyBlock = LooseRecord & {
  id: string;
  type: string;
};

/** Tool return shape expected by the OpenClaw plugin SDK. */
export type JsonContent = {
  content: Array<{ type: 'text'; text: string }>;
  details: null;
};

/** Parameters accepted by {@link queryNotionDatabase}. */
export type QueryParams = {
  database_id: string;
  filter?: string;
  sorts?: string;
  page_size?: number;
};

/** Parameters accepted by {@link deleteNotionPage}. */
export type DeleteParams = { page_id: string };

/** Parameters accepted by {@link moveNotionPage}. */
export type MoveParams = {
  page_id: string;
  new_parent_id: string;
};

/** Parameters accepted by {@link publishNotionPage}. */
export type PublishParams = {
  page_id: string;
  published?: boolean;
};

/** Parameters accepted by {@link getNotionFileTree}. */
export type FileTreeParams = {
  page_id: string;
  max_depth?: number;
};

/** Parameters accepted by {@link syncNotionFile}. */
export type SyncParams = {
  path: string;
  page_id?: string;
  parent_id?: string;
  direction?: 'push' | 'pull' | 'auto';
};

/** Parameters accepted by {@link uploadNotionFile}. */
export type UploadParams = {
  file_path: string;
  page_id: string;
  display_name?: string;
  content_type?: string;
};

/**
 * Capability interface for the Notion SDK's fileUploads namespace.
 *
 * The SDK types haven't caught up with the fileUploads API yet, so we define
 * the subset we use to avoid raw `any` casts throughout upload code.
 */
export type FileUploadsApi = {
  create: (args: {
    filename: string;
    content_type: string;
    mode: 'single_part';
  }) => Promise<{ id: string; upload_url: string }>;
  send: (args: {
    file_upload_id: string;
    file: import('node:fs').ReadStream;
    filename: string;
  }) => Promise<LooseRecord>;
};

/** Parameters accepted by {@link getNotionHelp}. */
export type HelpParams = { tool_name?: string };

/** Recursive tree structure returned by the file-tree walker. */
export type TreeNode = {
  title: string;
  id: string;
  url: string | null;
  type: 'page' | 'database';
  children: TreeNode[];
};

/** Static documentation entry for a single Notion tool. */
export type ToolDoc = {
  name: string;
  description: string;
  parameters: string[];
  example: string;
};

/** Parsed state of a local markdown file used during sync. */
export type LocalFileState = {
  absolutePath: string;
  exists: boolean;
  data: Record<string, unknown>;
  content: string;
  stat: Stats | null;
};

/**
 * Subset of the Notion pages API that exposes the 2026-03-11 enhanced
 * markdown endpoints. Cast through this type to access methods the SDK
 * types have not yet caught up with.
 */
export type MarkdownPageApi = {
  retrieveMarkdown: (args: { page_id: string }) => Promise<LooseRecord>;
  updateMarkdown: (
    args:
      | {
          page_id: string;
          type: 'replace_content';
          replace_content: { new_str: string; allow_deleting_content?: boolean };
        }
      | {
          page_id: string;
          type: 'update_content';
          update_content: {
            content_updates: Array<{
              old_str: string;
              new_str: string;
              replace_all_matches?: boolean;
            }>;
            allow_deleting_content?: boolean;
          };
        }
  ) => Promise<LooseRecord>;
};

/** Shape returned by both `databases.query` and `dataSources.query`. */
export type QueryResponse = {
  has_more: boolean;
  next_cursor: string | null;
  results: LooseRecord[];
};

/** Capability interface for SDK objects that support `.query()`. */
export type QueryCapability = {
  query?: (args: LooseRecord) => Promise<QueryResponse>;
};

/**
 * Union client type that covers both the stable `databases.query` path
 * and the newer `dataSources.query` fallback.
 */
export type QueryableNotionClient = {
  databases: QueryCapability;
  dataSources?: QueryCapability;
};
