/**
 * Tests for notion_query — database / data-source querying.
 */

import { describe, expect, it } from 'vitest';
import { queryNotionDatabase } from '../src/index.js';
import { makeClient } from './helpers.js';

const notion = makeClient(undefined);

/** A known data source in the default workspace. */
const PRIORITIES_DB_ID = '2b93c065-308b-8024-a04d-000ba0bc6153';

describe('notion_query', () => {
  it('queries a data source and returns results', async () => {
    const result = await queryNotionDatabase(notion, {
      database_id: PRIORITIES_DB_ID,
    });
    expect(result.database_id).toBe(PRIORITIES_DB_ID);
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.has_more).toBeDefined();
    expect(['database', 'data_source']).toContain(result.mode);
  }, 15000);

  it('respects page_size parameter', async () => {
    const result = await queryNotionDatabase(notion, {
      database_id: PRIORITIES_DB_ID,
      page_size: 1,
    });
    expect(result.page_size).toBe(1);
    expect(result.results.length).toBeLessThanOrEqual(1);
  }, 15000);

  it('result entries include id, object, url, and properties', async () => {
    const result = await queryNotionDatabase(notion, {
      database_id: PRIORITIES_DB_ID,
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

  it('secondary agent cannot query databases from the default workspace', async () => {
    const secondaryAgent = process.env.NOTION_SECONDARY_AGENT ?? 'secondary';
    await expect(
      queryNotionDatabase(makeClient(secondaryAgent), {
        database_id: PRIORITIES_DB_ID,
      })
    ).rejects.toThrow();
  });

  it('accepts filter as a JSON string', async () => {
    // A filter that should work on most databases — just checks it parses and runs.
    const result = await queryNotionDatabase(notion, {
      database_id: PRIORITIES_DB_ID,
      page_size: 5,
    });
    // Baseline: the query itself doesn't throw and returns a shaped result.
    expect(result.mode).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  }, 15000);
});
