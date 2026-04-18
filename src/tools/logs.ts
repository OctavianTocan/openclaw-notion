/**
 * Read audit logs from the local SQLite database.
 *
 * Wraps {@link readAuditLogs} from the audit module, mapping the tool's
 * snake_case parameter names to the camelCase options the query function expects.
 *
 * @module
 */

import { readAuditLogs } from '../audit.js';

/** Max rows the tool will ever return. */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export interface ReadNotionLogsParams {
  limit?: number;
  tool_name?: string;
  operation?: string;
  status?: 'success' | 'error';
  page_id?: string;
  database_id?: string;
  since?: string;
  session_id?: string;
  agent_id?: string;
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
