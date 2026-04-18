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

// Lazy-initialise the database connection and prepared statements. Deferring
// avoids loading the better-sqlite3 native binary at import time, which breaks
// test runners that don't need (or can't build) the addon.
let _db: InstanceType<typeof Database> | null = null;
let _insertOp: ReturnType<InstanceType<typeof Database>['prepare']>;
let _insertRequest: ReturnType<InstanceType<typeof Database>['prepare']>;
let _insertResponse: ReturnType<InstanceType<typeof Database>['prepare']>;

function getDb() {
  if (_db) return _db;

  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
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

  _insertOp = _db.prepare(`
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

  _insertRequest = _db.prepare(`
    INSERT INTO notion_raw_requests (body, url, method, headers)
    VALUES (@body, @url, @method, @headers)
  `);

  _insertResponse = _db.prepare(`
    INSERT INTO notion_raw_responses (status_code, body, headers)
    VALUES (@status_code, @body, @headers)
  `);

  return _db;
}

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
  getDb(); // ensure lazy init

  let requestId: number | undefined;
  let responseId: number | undefined;

  if (rawRequest) {
    requestId = _insertRequest.run({
      body: JSON.stringify(rawRequest),
      url: rawRequestUrl(rawRequest),
      method: rawRequestMethod(rawRequest),
      headers: JSON.stringify(rawRequestHeaders(rawRequest)),
    }).lastInsertRowid as number;
  }

  if (rawResponse) {
    responseId = _insertResponse.run({
      status_code: rawResponseStatusCode(rawResponse),
      body: JSON.stringify(rawResponse),
      headers: JSON.stringify(rawResponseHeaders(rawResponse)),
    }).lastInsertRowid as number;
  }

  const result = _insertOp.run({
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

/* ─── Safe JSON parsing ─────────────────────────────────────────────────── */

/**
 * Parse a JSON string without throwing on malformed data.
 *
 * Returns `null` when the value is nullish, non-string, or unparseable,
 * so a single corrupt row can't break an entire audit log read.
 */
export function safeJsonParse(value: unknown): unknown | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Redact sensitive fields (Authorization headers, tokens) from a parsed
 * request body object so raw log reads don't leak credentials.
 */
export function redactSensitiveFields(obj: unknown): unknown {
  if (obj == null || typeof obj !== 'object') return obj;
  const record = obj as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(record)) {
    if (key.toLowerCase().includes('authorization') || key.toLowerCase().includes('token')) {
      result[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      result[key] = redactSensitiveFields(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/* ─── Query helpers ──────────────────────────────────────────────────────── */

/**
 * Clamp a limit value to a safe non-negative integer in the range [0, 100].
 *
 * Rejects NaN, fractional, and negative values that could cause unexpected
 * SQLite behaviour (e.g. `LIMIT -1` disables the cap entirely).
 */
export function clampLimit(raw: number | undefined, fallback = 20): number {
  const n = raw ?? fallback;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  return Math.max(0, Math.min(n, 100));
}

/**
 * Extended audit log reader supporting all filterable columns.
 *
 * Unlike {@link getOperations} (which predates the tool surface), this function
 * covers every filter the `notion_logs_read` tool exposes, including tool_name,
 * status, session_id, and target_database_id, and optionally JOINs the raw
 * request/response tables so callers can inspect full HTTP payloads.
 */
export function readAuditLogs(opts: {
  agentId?: string;
  sessionId?: string;
  operation?: string;
  toolName?: string;
  status?: 'success' | 'error';
  targetPageId?: string;
  targetDatabaseId?: string;
  since?: string;
  limit?: number;
  includeRaw?: boolean;
}) {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (opts.agentId) {
    conditions.push('o.agent_id = @agentId');
    params.agentId = opts.agentId;
  }
  if (opts.sessionId) {
    conditions.push('o.session_id = @sessionId');
    params.sessionId = opts.sessionId;
  }
  if (opts.operation) {
    conditions.push('o.operation = @operation');
    params.operation = opts.operation;
  }
  if (opts.toolName) {
    conditions.push('o.tool_name = @toolName');
    params.toolName = opts.toolName;
  }
  if (opts.status) {
    conditions.push('o.status = @status');
    params.status = opts.status;
  }
  if (opts.targetPageId) {
    conditions.push('o.target_page_id = @targetPageId');
    params.targetPageId = opts.targetPageId;
  }
  if (opts.targetDatabaseId) {
    conditions.push('o.target_database_id = @targetDatabaseId');
    params.targetDatabaseId = opts.targetDatabaseId;
  }
  if (opts.since) {
    // Normalize to canonical ISO-8601 with milliseconds so lexicographic
    // comparison matches the toISOString() format stored in the DB.
    const d = new Date(opts.since);
    conditions.push('o.timestamp >= @since');
    params.since = Number.isNaN(d.getTime()) ? opts.since : d.toISOString();
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = clampLimit(opts.limit);
  params.limit = limit;

  // When include_raw is true, JOIN the raw request/response tables so the
  // caller can inspect full HTTP payloads for debugging.
  if (opts.includeRaw) {
    const sql = `
      SELECT o.*,
             req.url   AS raw_request_url,
             req.method AS raw_request_method,
             req.body   AS raw_request_body,
             req.headers AS raw_request_headers,
             res.status_code AS raw_response_status,
             res.body   AS raw_response_body,
             res.headers AS raw_response_headers
        FROM notion_operations o
        LEFT JOIN notion_raw_requests  req ON o.request_id  = req.id
        LEFT JOIN notion_raw_responses res ON o.response_id = res.id
        ${where}
        ORDER BY o.timestamp DESC
        LIMIT @limit`;
    const rows = db.prepare(sql).all(params) as Record<string, unknown>[];
    return rows.map((row) => ({
      ...row,
      state_before: safeJsonParse(row.state_before),
      state_after: safeJsonParse(row.state_after),
      raw_request_body: redactSensitiveFields(safeJsonParse(row.raw_request_body)),
      raw_request_headers: redactSensitiveFields(safeJsonParse(row.raw_request_headers)),
      raw_response_body: safeJsonParse(row.raw_response_body),
      raw_response_headers: safeJsonParse(row.raw_response_headers),
    }));
  }

  // Compact path: skip JOINs and omit state_before/state_after blobs to keep
  // output concise. These columns are large and rarely needed in quick overviews.
  const sql = `
    SELECT o.id, o.timestamp, o.agent_id, o.session_id, o.test_run,
           o.operation, o.tool_name, o.target_page_id, o.target_database_id,
           o.parent_page_id, o.local_path, o.sync_direction, o.status,
           o.error_code, o.error_message, o.notion_request_id, o.duration_ms
      FROM notion_operations o
      ${where}
      ORDER BY o.timestamp DESC
      LIMIT @limit`;
  return db.prepare(sql).all(params) as Record<string, unknown>[];
}

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

  const rows = getDb()
    .prepare(`SELECT * FROM notion_operations ${where} ORDER BY timestamp DESC LIMIT ${limit}`)
    .all(params) as Record<string, unknown>[];

  return rows.map((row) => ({
    ...row,
    state_before: safeJsonParse(row.state_before),
    state_after: safeJsonParse(row.state_after),
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
