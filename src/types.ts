import type { Stats } from "node:fs";

export type LooseRecord = Record<string, unknown>;

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

export type AnyDatabase = LooseRecord & {
  id: string;
  url?: string | null;
  properties?: LooseRecord;
  title?: unknown[];
};

export type AnyBlock = LooseRecord & {
  id: string;
  type: string;
};

export type JsonContent = {
  content: Array<{ type: "text"; text: string }>;
  details: null;
};

export type QueryParams = {
  database_id: string;
  filter?: string;
  sorts?: string;
  page_size?: number;
};

export type DeleteParams = { page_id: string };

export type MoveParams = {
  page_id: string;
  new_parent_id: string;
};

export type PublishParams = {
  page_id: string;
  published?: boolean;
};

export type FileTreeParams = {
  page_id: string;
  max_depth?: number;
};

export type SyncParams = {
  path: string;
  page_id?: string;
  parent_id?: string;
  direction?: "push" | "pull" | "auto";
};

export type HelpParams = { tool_name?: string };

export type TreeNode = {
  title: string;
  id: string;
  url: string | null;
  type: "page" | "database";
  children: TreeNode[];
};

export type ToolDoc = {
  name: string;
  description: string;
  parameters: string[];
  example: string;
};

export type LocalFileState = {
  absolutePath: string;
  exists: boolean;
  data: Record<string, unknown>;
  content: string;
  stat: Stats | null;
};

export type MarkdownPageApi = {
  retrieveMarkdown: (args: { page_id: string }) => Promise<LooseRecord>;
  updateMarkdown: (args: {
    page_id: string;
    type: "replace_content";
    replace_content: { new_str: string };
  }) => Promise<LooseRecord>;
};

export type QueryResponse = {
  has_more: boolean;
  next_cursor: string | null;
  results: LooseRecord[];
};

export type QueryCapability = {
  query?: (args: LooseRecord) => Promise<QueryResponse>;
};

export type QueryableNotionClient = {
  databases: QueryCapability;
  dataSources?: QueryCapability;
};
