/**
 * SQLite-backed audit logger for all Notion API operations.
 *
 * Every operation is logged with full state snapshots before/after,
 * raw request/response bodies, and Notion API tracing headers.
 *
 * Log lives at ~/.openclaw/logs/notion-operations.db
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type Operation =
  | 'search'
  | 'read'
  | 'append'
  | 'create'
  | 'update'
  | 'update_markdown'
  | 'delete'
  | 'restore'
  | 'move'
  | 'comment_create'
  | 'comment_list'
  | 'query'
  | 'file_tree'
  | 'sync_push'
  | 'sync_pull'
  | 'sync_auto'
  | 'help'
  | 'doctor';

export interface AuditContext {
  agentId: string;
  sessionId?: string;
  testRun?: boolean;
}

interface LogOptions {
  operation: Operation;
  toolName: string;
  targetPageId?: string;
  targetDatabaseId?: string;
  parentPageId?: string;
  localPath?: string;
  syncDirection?: 'push' | 'pull' | 'auto';
  status: 'success' | 'error';
  errorCode?: string;
  errorMessage?: string;
  notionRequestId?: string;
  durationMs?: number;
  stateBefore?: Record<string, unknown> | null;
  stateAfter?: Record<string, unknown> | null;
  rawRequest?: object;
  rawResponse?: object;
}

/* ─── Database setup ─────────────────────────────────────────────────────── */

const DB_PATH = path.join(
  process.env.XDG_DATA_HOME ?? path.join(process.env.HOME ?? '/home/octavian', '.openclaw', 'data'),
  'notion-operations.db'
);

// Ensure directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS notion_operations (
    id                 INTEGER PRIMARY KEY,
    timestamp          TEXT    NOT NULL,
    agent_id           TEXT,
    session_id         TEXT,
    test_run           INTEGER NOT NULL DEFAULT 0,
    operation          TEXT    NOT NULL,
    tool_name          TEXT    NOT NULL,
    target_page_id     TEXT,
    target_database_id TEXT,
    parent_page_id     TEXT,
    local_path         TEXT,
    sync_direction     TEXT,
    status             TEXT    NOT NULL,
    error_code         TEXT,
    error_message      TEXT,
    notion_request_id  TEXT,
    duration_ms        INTEGER,
    state_before       TEXT,
    state_after        TEXT,
    request_id         INTEGER REFERENCES notion_raw_requests(id),
    response_id        INTEGER REFERENCES notion_raw_responses(id)
  );

  CREATE TABLE IF NOT EXISTS notion_raw_requests (
    id       INTEGER PRIMARY KEY,
    body     TEXT    NOT NULL,
    url      TEXT    NOT NULL,
    method   TEXT    NOT NULL,
    headers  TEXT
  );

  CREATE TABLE IF NOT EXISTS notion_raw_responses (
    id           INTEGER PRIMARY KEY,
    status_code  INTEGER,
    body         TEXT,
    headers      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_ops_timestamp    ON notion_operations(timestamp);
  CREATE INDEX IF NOT EXISTS idx_ops_agent       ON notion_operations(agent_id);
  CREATE INDEX IF NOT EXISTS idx_ops_target_page  ON notion_operations(target_page_id);
  CREATE INDEX IF NOT EXISTS idx_ops_operation   ON notion_operations(operation);
  CREATE INDEX IF NOT EXISTS idx_ops_session     ON notion_operations(session_id);
  CREATE INDEX IF NOT EXISTS idx_ops_test_run    ON notion_operations(test_run) WHERE test_run = 1;
`);

/* ─── Prepared statements ────────────────────────────────────────────────── */

const insertOp = db.prepare(`
  INSERT INTO notion_operations (
    timestamp, agent_id, session_id, test_run, operation, tool_name,
    target_page_id, target_database_id, parent_page_id, local_path,
    sync_direction, status, error_code, error_message, notion_request_id,
    duration_ms, state_before, state_after, request_id, response_id
  ) VALUES (
    @timestamp, @agent_id, @session_id, @test_run, @operation, @tool_name,
    @target_page_id, @target_database_id, @parent_page_id, @local_path,
    @sync_direction, @status, @error_code, @error_message, @notion_request_id,
    @duration_ms, @state_before, @state_after, @request_id, @response_id
  )
`);

const insertRequest = db.prepare(`
  INSERT INTO notion_raw_requests (body, url, method, headers)
  VALUES (@body, @url, @method, @headers)
`);

const insertResponse = db.prepare(`
  INSERT INTO notion_raw_responses (status_code, body, headers)
  VALUES (@status_code, @body, @headers)
`);

/* ─── Audit logger ───────────────────────────────────────────────────────── */

let context: AuditContext = {
  agentId: 'default',
  sessionId: undefined,
  testRun: false,
};

export function setAuditContext(ctx: AuditContext) {
  context = { ...ctx };
}

export function getAuditContext(): AuditContext {
  return { ...context };
}

export function logOperation(opts: LogOptions): number {
  const { rawRequest, rawResponse, ...rest } = opts;

  let requestId: number | undefined;
  let responseId: number | undefined;

  if (rawRequest) {
    requestId = insertRequest.run({
      body: JSON.stringify(rawRequest),
      url: rawRequestUrl(rawRequest),
      method: rawRequestMethod(rawRequest),
      headers: JSON.stringify(rawRequestHeaders(rawRequest)),
    }).lastInsertRowid as number;
  }

  if (rawResponse) {
    responseId = insertResponse.run({
      status_code: rawResponseStatusCode(rawResponse),
      body: JSON.stringify(rawResponse),
      headers: JSON.stringify(rawResponseHeaders(rawResponse)),
    }).lastInsertRowid as number;
  }

  const result = insertOp.run({
    timestamp: new Date().toISOString(),
    agent_id: context.agentId,
    session_id: context.sessionId ?? null,
    test_run: context.testRun ? 1 : 0,
    operation: rest.operation,
    tool_name: rest.toolName,
    target_page_id: rest.targetPageId ?? null,
    target_database_id: rest.targetDatabaseId ?? null,
    parent_page_id: rest.parentPageId ?? null,
    local_path: rest.localPath ?? null,
    sync_direction: rest.syncDirection ?? null,
    status: rest.status,
    error_code: rest.errorCode ?? null,
    error_message: rest.errorMessage ?? null,
    notion_request_id: rest.notionRequestId ?? null,
    duration_ms: rest.durationMs ?? null,
    state_before: rest.stateBefore !== undefined ? JSON.stringify(rest.stateBefore) : null,
    state_after: rest.stateAfter !== undefined ? JSON.stringify(rest.stateAfter) : null,
    request_id: requestId ?? null,
    response_id: responseId ?? null,
  });

  return result.lastInsertRowid as number;
}

/* ─── Helpers to extract raw data from Notion SDK request/response objects ── */

function rawRequestUrl(req: object): string {
  return String((req as { url?: string }).url ?? '');
}

function rawRequestMethod(req: object): string {
  return String((req as { method?: string }).method ?? 'POST');
}

function rawRequestHeaders(req: object): Record<string, string> {
  const h = (req as { headers?: Record<string, string> }).headers ?? {};
  // Strip auth key from logs
  const sanitized: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    sanitized[k] = k.toLowerCase().includes('authorization') ? '[REDACTED]' : v;
  }
  return sanitized;
}

function rawResponseStatusCode(res: object): number {
  return Number((res as { statusCode?: number }).statusCode ?? 200);
}

function rawResponseHeaders(res: object): Record<string, string> {
  return (res as { headers?: Record<string, string> }).headers ?? {};
}

/* ─── Query helpers ──────────────────────────────────────────────────────── */

export function getOperations(opts: {
  agentId?: string;
  operation?: Operation;
  targetPageId?: string;
  since?: string;
  limit?: number;
  testRunOnly?: boolean;
}) {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (opts.agentId) {
    conditions.push('agent_id = @agentId');
    params.agentId = opts.agentId;
  }
  if (opts.operation) {
    conditions.push('operation = @operation');
    params.operation = opts.operation;
  }
  if (opts.targetPageId) {
    conditions.push('target_page_id = @targetPageId');
    params.targetPageId = opts.targetPageId;
  }
  if (opts.since) {
    conditions.push('timestamp >= @since');
    params.since = opts.since;
  }
  if (opts.testRunOnly) {
    conditions.push('test_run = 1');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit ?? 100;

  const rows = db
    .prepare(`SELECT * FROM notion_operations ${where} ORDER BY timestamp DESC LIMIT ${limit}`)
    .all(params) as Record<string, unknown>[];

  return rows.map((row) => ({
    ...row,
    state_before: row.state_before ? JSON.parse(row.state_before as string) : null,
    state_after: row.state_after ? JSON.parse(row.state_after as string) : null,
  }));
}

export function getDeletedPages(opts: { agentId?: string; since?: string }) {
  return getOperations({
    agentId: opts.agentId,
    operation: 'delete',
    since: opts.since,
    limit: 500,
  });
}
