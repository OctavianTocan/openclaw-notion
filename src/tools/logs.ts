/**
 * Read audit logs from the local SQLite database.
 *
 * Wraps {@link readAuditLogs} from the audit module, mapping the tool's
 * snake_case parameter names to the camelCase options the query function expects.
 *
 * @module
 */

import { readAuditLogs } from '../audit.js';

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
 * Returns an object with `count` and `rows` so the caller always knows
 * how many results came back without counting array elements.
 */
export function readNotionLogs(params: ReadNotionLogsParams) {
  const rows = readAuditLogs({
    agentId: params.agent_id,
    sessionId: params.session_id,
    operation: params.operation,
    toolName: params.tool_name,
    status: params.status,
    targetPageId: params.page_id,
    targetDatabaseId: params.database_id,
    since: params.since,
    limit: params.limit,
    includeRaw: params.include_raw,
  });

  return { count: rows.length, rows };
}
