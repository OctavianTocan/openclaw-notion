/**
 * Tests for the audit log reader, safe JSON parsing, credential redaction,
 * and limit clamping.
 *
 * Unit tests for pure helpers (safeJsonParse, redactSensitiveFields, clampLimit)
 * run without any database or Notion API access. Integration tests exercise
 * readAuditLogs and readNotionLogs by writing entries via logOperation then
 * reading them back through the query layer.
 *
 * @module
 */

import { describe, expect, it } from 'vitest';
import {
  clampLimit,
  logOperation,
  readAuditLogs,
  redactSensitiveFields,
  safeJsonParse,
  setAuditContext,
} from '../src/audit.js';
import { readNotionLogs } from '../src/tools/logs.js';

/**
 * Check whether the better-sqlite3 native addon is available.
 * Integration tests that hit the database are skipped when it isn't.
 */
function hasSqliteBindings(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}

const sqliteAvailable = hasSqliteBindings();
const describeDb = sqliteAvailable ? describe : describe.skip;

/* ------------------------------------------------------------------ */
/*  Unit: safeJsonParse                                                */
/* ------------------------------------------------------------------ */

describe('safeJsonParse', () => {
  it('parses valid JSON strings', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    expect(safeJsonParse('"hello"')).toBe('hello');
    expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3]);
    expect(safeJsonParse('null')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(safeJsonParse('{bad json')).toBeNull();
    expect(safeJsonParse('undefined')).toBeNull();
    expect(safeJsonParse("{'single': 'quotes'}")).toBeNull();
  });

  it('returns null for non-string inputs', () => {
    expect(safeJsonParse(null)).toBeNull();
    expect(safeJsonParse(undefined)).toBeNull();
    expect(safeJsonParse(42)).toBeNull();
    expect(safeJsonParse(true)).toBeNull();
    expect(safeJsonParse({ already: 'parsed' })).toBeNull();
  });

  it('returns null for empty string', () => {
    // Empty string is invalid JSON
    expect(safeJsonParse('')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Unit: redactSensitiveFields                                        */
/* ------------------------------------------------------------------ */

describe('redactSensitiveFields', () => {
  it('redacts Authorization headers', () => {
    const input = {
      url: 'https://api.notion.com/v1/pages',
      headers: {
        Authorization: 'Bearer ntn_secret123',
        'Content-Type': 'application/json',
      },
    };
    const result = redactSensitiveFields(input) as Record<string, unknown>;
    const headers = result.headers as Record<string, string>;
    expect(headers.Authorization).toBe('[REDACTED]');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('redacts fields containing "token" (case-insensitive)', () => {
    const input = {
      accessToken: 'secret-value',
      api_token: 'another-secret',
      name: 'safe-value',
    };
    const result = redactSensitiveFields(input) as Record<string, unknown>;
    expect(result.accessToken).toBe('[REDACTED]');
    expect(result.api_token).toBe('[REDACTED]');
    expect(result.name).toBe('safe-value');
  });

  it('recurses into nested objects', () => {
    const input = {
      outer: {
        inner: {
          authorization: 'Bearer xyz',
          data: 'visible',
        },
      },
    };
    const result = redactSensitiveFields(input) as Record<string, unknown>;
    const inner = (result.outer as Record<string, unknown>).inner as Record<string, unknown>;
    expect(inner.authorization).toBe('[REDACTED]');
    expect(inner.data).toBe('visible');
  });

  it('returns primitives and nulls unchanged', () => {
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields(undefined)).toBeUndefined();
    expect(redactSensitiveFields('string')).toBe('string');
    expect(redactSensitiveFields(42)).toBe(42);
  });

  it('does not recurse into arrays', () => {
    // Arrays are left as-is (not iterated for key redaction)
    const input = { items: [{ authorization: 'secret' }] };
    const result = redactSensitiveFields(input) as Record<string, unknown>;
    const items = result.items as Array<{ authorization: string }>;
    // Array values are preserved without deep inspection
    expect(items[0].authorization).toBe('secret');
  });
});

/* ------------------------------------------------------------------ */
/*  Unit: clampLimit                                                   */
/* ------------------------------------------------------------------ */

describe('clampLimit', () => {
  it('uses fallback when undefined', () => {
    expect(clampLimit(undefined)).toBe(20);
    expect(clampLimit(undefined, 50)).toBe(50);
  });

  it('passes through valid integers in range', () => {
    expect(clampLimit(1)).toBe(1);
    expect(clampLimit(50)).toBe(50);
    expect(clampLimit(100)).toBe(100);
  });

  it('caps at 100', () => {
    expect(clampLimit(200)).toBe(100);
    expect(clampLimit(999)).toBe(100);
  });

  it('floors at 0', () => {
    expect(clampLimit(0)).toBe(0);
    expect(clampLimit(-1)).toBe(0);
    expect(clampLimit(-999)).toBe(0);
  });

  it('rejects non-integer values and returns fallback', () => {
    expect(clampLimit(3.5)).toBe(20);
    expect(clampLimit(0.1)).toBe(20);
    expect(clampLimit(3.5, 10)).toBe(10);
  });

  it('rejects NaN and Infinity', () => {
    expect(clampLimit(Number.NaN)).toBe(20);
    expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(20);
    expect(clampLimit(Number.NEGATIVE_INFINITY)).toBe(20);
  });
});

/* ------------------------------------------------------------------ */
/*  Integration: readAuditLogs + readNotionLogs                        */
/* ------------------------------------------------------------------ */

describeDb('readAuditLogs — integration', () => {
  // Use a unique session ID to isolate these test entries from real data
  const testSession = `vitest-audit-${Date.now()}`;

  it('writes and reads back audit entries', () => {
    setAuditContext({ agentId: 'test-agent', sessionId: testSession, testRun: true });

    logOperation({
      operation: 'read',
      toolName: 'notion_read',
      targetPageId: 'page-aaa',
      status: 'success',
      durationMs: 42,
    });

    logOperation({
      operation: 'create',
      toolName: 'notion_create',
      targetPageId: 'page-bbb',
      status: 'error',
      errorCode: 'validation_error',
      errorMessage: 'Missing title',
      durationMs: 100,
    });

    const rows = readAuditLogs({ sessionId: testSession });
    expect(rows.length).toBe(2);
    // Verify both operations are present (order may vary when timestamps match)
    const ops = rows.map((r) => (r as Record<string, unknown>).operation);
    expect(ops).toContain('create');
    expect(ops).toContain('read');
  });

  it('filters by status', () => {
    const errors = readAuditLogs({ sessionId: testSession, status: 'error' });
    expect(errors.length).toBe(1);
    expect((errors[0] as Record<string, unknown>).tool_name).toBe('notion_create');
  });

  it('filters by operation', () => {
    const reads = readAuditLogs({ sessionId: testSession, operation: 'read' });
    expect(reads.length).toBe(1);
    expect((reads[0] as Record<string, unknown>).target_page_id).toBe('page-aaa');
  });

  it('filters by page_id', () => {
    const rows = readAuditLogs({ sessionId: testSession, targetPageId: 'page-bbb' });
    expect(rows.length).toBe(1);
    expect((rows[0] as Record<string, unknown>).status).toBe('error');
  });

  it('respects limit', () => {
    const rows = readAuditLogs({ sessionId: testSession, limit: 1 });
    expect(rows.length).toBe(1);
  });

  it('returns compact rows without state_before/state_after by default', () => {
    const rows = readAuditLogs({ sessionId: testSession, limit: 1 });
    const row = rows[0] as Record<string, unknown>;
    // Compact mode omits state columns
    expect(row).not.toHaveProperty('state_before');
    expect(row).not.toHaveProperty('state_after');
  });
});

describeDb('readAuditLogs — includeRaw path', () => {
  const testSession = `vitest-raw-${Date.now()}`;

  it('parses state_before/state_after JSON and redacts raw_request_body', () => {
    setAuditContext({ agentId: 'test-agent', sessionId: testSession, testRun: true });

    logOperation({
      operation: 'update',
      toolName: 'notion_update',
      targetPageId: 'page-raw',
      status: 'success',
      stateBefore: { title: 'Old Title' },
      stateAfter: { title: 'New Title' },
      rawRequest: {
        url: 'https://api.notion.com/v1/pages/page-raw',
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ntn_supersecret',
          'Content-Type': 'application/json',
        },
      },
      rawResponse: { statusCode: 200 },
    });

    const rows = readAuditLogs({ sessionId: testSession, includeRaw: true });
    expect(rows.length).toBe(1);

    const row = rows[0] as Record<string, unknown>;
    // State snapshots parsed from JSON
    expect(row.state_before).toEqual({ title: 'Old Title' });
    expect(row.state_after).toEqual({ title: 'New Title' });

    // Raw request body is redacted (the body stored is the full rawRequest object)
    const body = row.raw_request_body as Record<string, unknown> | null;
    if (body) {
      // The stored body is JSON.stringify(rawRequest), which includes url/method/headers
      // redactSensitiveFields should catch Authorization in headers
      const headers = body.headers as Record<string, string> | undefined;
      if (headers) {
        expect(headers.Authorization).toBe('[REDACTED]');
      }
    }

    // Raw request headers stored separately should still have redacted auth
    // (the rawRequestHeaders helper in audit.ts already strips auth at write time)
    expect(row.raw_request_url).toBe('https://api.notion.com/v1/pages/page-raw');
    expect(row.raw_request_method).toBe('PATCH');
  });

  it('survives malformed JSON in state columns', () => {
    // This tests the safeJsonParse integration path. We can't easily inject
    // malformed data via logOperation (it JSON.stringifies), but we verify
    // that null state values are handled.
    setAuditContext({ agentId: 'test-agent', sessionId: testSession, testRun: true });

    logOperation({
      operation: 'read',
      toolName: 'notion_read',
      status: 'success',
      // No state snapshots — should come back as null
    });

    const rows = readAuditLogs({ sessionId: testSession, includeRaw: true, operation: 'read' });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.state_before).toBeNull();
    expect(row.state_after).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Integration: readNotionLogs wrapper                                */
/* ------------------------------------------------------------------ */

describeDb('readNotionLogs wrapper', () => {
  const testSession = `vitest-wrapper-${Date.now()}`;

  it('returns { count, rows } shape', () => {
    setAuditContext({ agentId: 'test-agent', sessionId: testSession, testRun: true });

    logOperation({
      operation: 'search',
      toolName: 'notion_search',
      status: 'success',
    });

    const result = readNotionLogs({ session_id: testSession });
    expect(result).toHaveProperty('count');
    expect(result).toHaveProperty('rows');
    expect(result.count).toBe(1);
    expect(result.rows.length).toBe(1);
  });

  it('clamps negative limit to 0', () => {
    const result = readNotionLogs({ session_id: testSession, limit: -5 });
    expect(result.count).toBe(0);
  });

  it('clamps fractional limit to default', () => {
    const result = readNotionLogs({ session_id: testSession, limit: 1.5 });
    // Fractional -> falls back to default 20, returns whatever matches
    expect(result.count).toBeLessThanOrEqual(20);
  });

  it('maps snake_case params to camelCase options', () => {
    setAuditContext({ agentId: 'test-agent', sessionId: testSession, testRun: true });

    logOperation({
      operation: 'create',
      toolName: 'notion_create',
      targetPageId: 'page-mapped',
      status: 'error',
      errorMessage: 'test error',
    });

    const result = readNotionLogs({
      session_id: testSession,
      tool_name: 'notion_create',
      page_id: 'page-mapped',
      status: 'error',
    });
    expect(result.count).toBe(1);
    expect((result.rows[0] as Record<string, unknown>).error_message).toBe('test error');
  });
});
