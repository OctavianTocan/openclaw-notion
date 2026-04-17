/**
 * Tests for notion_query — database / data-source querying.
 *
 * The 2026-03-11 Notion API splits "databases" (API-created, legacy) from
 * "data sources" (UI-created). `dataSources.query` — the only query
 * endpoint on this SDK — cannot see databases created via `databases.create`.
 * Because the test cannot programmatically create a queryable data source,
 * it discovers one at runtime via search. If the workspace contains none
 * the entire suite is skipped rather than falsely failing.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { queryNotionDatabase } from '../src/index.js';
import { makeClient } from './helpers.js';

const notion = makeClient(undefined);

describe('notion_query', () => {
  let dataSourceId: string;

  beforeAll(async () => {
    const response = await notion.search({
      filter: { property: 'object', value: 'data_source' },
      page_size: 1,
    });
    if (response.results.length === 0) {
      console.warn('No data sources found in the workspace — skipping notion_query tests.');
      return;
    }
    dataSourceId = response.results[0].id;
  });

  it('queries a data source and returns results', async ({ skip }) => {
    if (!dataSourceId) skip();
    const result = await queryNotionDatabase(notion, { database_id: dataSourceId });
    expect(result.database_id).toBe(dataSourceId);
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.has_more).toBeDefined();
    expect(['database', 'data_source']).toContain(result.mode);
  }, 15000);

  it('respects page_size parameter', async ({ skip }) => {
    if (!dataSourceId) skip();
    const result = await queryNotionDatabase(notion, {
      database_id: dataSourceId,
      page_size: 1,
    });
    expect(result.page_size).toBe(1);
    expect(result.results.length).toBeLessThanOrEqual(1);
  }, 15000);

  it('result entries include id, object, and properties', async ({ skip }) => {
    if (!dataSourceId) skip();
    const result = await queryNotionDatabase(notion, {
      database_id: dataSourceId,
      page_size: 2,
    });
    for (const entry of result.results) {
      expect(entry.id).toBeDefined();
      expect(entry.object).toBeDefined();
      expect(entry.properties).toBeDefined();
    }
  }, 15000);

  it('rejects an invalid database ID', async () => {
    await expect(
      queryNotionDatabase(notion, {
        database_id: '00000000-0000-0000-0000-000000000000',
      })
    ).rejects.toThrow();
  });

  it('secondary agent cannot query data sources from the default workspace', async ({ skip }) => {
    if (!dataSourceId) skip();
    const secondaryAgent = process.env.NOTION_SECONDARY_AGENT ?? 'secondary';
    await expect(
      queryNotionDatabase(makeClient(secondaryAgent), {
        database_id: dataSourceId,
      })
    ).rejects.toThrow();
  });
});
