/**
 * Read audit logs from the local SQLite database.
 *
 * Wraps {@link readAuditLogs} from the audit module, mapping the tool's
 * snake_case parameter names to the camelCase options the query function expects.
 *
 * @module
 */

// ESM requires explicit file extensions in import specifiers. TypeScript compiles
// .ts → .js, so we reference the compiled output extension here.
import { readAuditLogs } from '../audit.js';

/** Max rows the tool will ever return. */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/**
 * Parameters accepted by {@link readNotionLogs}.
 *
 * Field names use snake_case to match the MCP tool schema exposed to callers;
 * the function maps them to the camelCase options the audit module expects.
 */
export interface ReadNotionLogsParams {
  /** Maximum number of rows to return (clamped to {@link MAX_LIMIT}). */
  limit?: number;
  /** Filter by the MCP tool name that produced the log entry. */
  tool_name?: string;
  /** Filter by operation type (e.g. `'search'`, `'read'`, `'create'`). */
  operation?: string;
  /** Filter by outcome: `'success'` or `'error'`. */
  status?: 'success' | 'error';
  /** Filter by the Notion page ID the operation targeted. */
  page_id?: string;
  /** Filter by the Notion database ID the operation targeted. */
  database_id?: string;
  /** ISO-8601 timestamp lower bound — only entries at or after this time. */
  since?: string;
  /** Filter by the MCP session that produced the entry. */
  session_id?: string;
  /** Filter by the agent that produced the entry. */
  agent_id?: string;
  /** When `true`, JOIN raw HTTP request/response payloads into each row. */
  include_raw?: boolean;
}

/**
 * Query the notion-operations.db audit log with the given filters.
 *
 * Clamps `limit` to a safe non-negative integer (max 100) so callers
 * outside the tool schema can't accidentally request unbounded reads.
 * Returns an object with `count` and `rows` so the caller always knows
 * how many results came back without counting array elements.
 */
export function readNotionLogs(params: ReadNotionLogsParams) {
  const rawLimit = params.limit ?? DEFAULT_LIMIT;
  const limit = Math.max(
    0,
    Math.min(
      Number.isFinite(rawLimit) && Number.isInteger(rawLimit) ? rawLimit : DEFAULT_LIMIT,
      MAX_LIMIT
    )
  );

  const rows = readAuditLogs({
    agentId: params.agent_id,
    sessionId: params.session_id,
    operation: params.operation,
    toolName: params.tool_name,
    status: params.status,
    targetPageId: params.page_id,
    targetDatabaseId: params.database_id,
    since: params.since,
    limit,
    includeRaw: params.include_raw,
  });

  return { count: rows.length, rows };
}
