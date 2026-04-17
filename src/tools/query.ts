/**
 * Database and data-source query tool.
 *
 * Tries the standard `databases.query` endpoint first. If it fails with
 * `object_not_found` or `validation_error` (common when the UUID points
 * at a data source rather than a classic database), falls back to
 * `dataSources.query`.
 */

import type { Client } from '@notionhq/client';
import { DEFAULT_PAGE_SIZE } from '../constants.js';
import { parseJsonInput } from '../format.js';
import { shouldFallbackQuery } from '../helpers.js';
import type { LooseRecord, QueryableNotionClient, QueryParams, QueryResponse } from '../types.js';

/**
 * Trim query results to the fields agents actually need.
 *
 * @param results - Raw result array from either query endpoint.
 * @returns Slimmed-down entries with id, object, url, and properties.
 */
function mapResults(results: QueryResponse['results']) {
  return results.map((entry: LooseRecord) => ({
    id: entry.id,
    object: entry.object,
    url: entry.url ?? null,
    properties: entry.properties ?? null,
  }));
}

/**
 * Query a Notion database or data source.
 *
 * @param notion - Authenticated Notion client.
 * @param params - Query parameters including optional filter/sorts JSON strings.
 * @returns Paginated, trimmed result set with mode indicator.
 * @throws {Error} When neither `databases.query` nor `dataSources.query` succeeds.
 */
export async function queryNotionDatabase(notion: Client, params: QueryParams) {
  const pageSize = params.page_size ?? DEFAULT_PAGE_SIZE;
  const filter = parseJsonInput<Record<string, unknown>>(params.filter, 'filter');
  const sorts = parseJsonInput<Array<Record<string, unknown>>>(params.sorts, 'sorts');

  const queryableNotion = notion as unknown as QueryableNotionClient;
  const queryFn = queryableNotion.databases.query?.bind(queryableNotion.databases);
  const dataSourceFn = queryableNotion.dataSources?.query?.bind(queryableNotion.dataSources);

  // Try standard database query first.
  if (queryFn) {
    try {
      const response = await queryFn({
        database_id: params.database_id,
        filter,
        sorts,
        page_size: pageSize,
      });
      return {
        mode: 'database',
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
      // Fall through to dataSources.query.
    }
  }

  if (!dataSourceFn) {
    throw new Error('Neither databases.query nor dataSources.query is available in the SDK.');
  }

  // Fallback: data source query.
  const response = await dataSourceFn({
    data_source_id: params.database_id,
    filter,
    sorts,
    page_size: pageSize,
  });
  return {
    mode: 'data_source',
    database_id: params.database_id,
    page_size: pageSize,
    has_more: response.has_more,
    next_cursor: response.next_cursor,
    results: mapResults(response.results),
  };
}
