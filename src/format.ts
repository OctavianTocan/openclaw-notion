/**
 * Response formatting utilities for OpenClaw tool output.
 *
 * Every tool registered through the plugin SDK must return a `JsonContent`
 * shape. These helpers standardise serialisation so tool implementations
 * stay focused on Notion logic.
 */

import type { JsonContent, LooseRecord } from './types.js';

/**
 * Wrap an arbitrary value as pretty-printed JSON tool output.
 *
 * @param value - Any JSON-serialisable value.
 * @returns Tool-compatible content envelope.
 */
export function asJsonContent(value: unknown): JsonContent {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    details: null,
  };
}

/**
 * Wrap a plain string as tool output (no JSON encoding).
 *
 * @param text - Raw text to return to the agent.
 * @returns Tool-compatible content envelope.
 */
export function asTextContent(text: string): JsonContent {
  return {
    content: [{ type: 'text', text }],
    details: null,
  };
}

/**
 * Parse a user-supplied JSON string into a typed object.
 *
 * @param raw - The raw JSON string, or `undefined` to skip.
 * @param fieldName - Human-readable name used in error messages.
 * @returns The parsed value, or `undefined` when `raw` is falsy.
 * @throws {Error} When the string is present but contains invalid JSON.
 */
export function parseJsonInput<T>(raw: string | undefined, fieldName: string): T | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${fieldName} JSON: ${message}`);
  }
}

/**
 * Normalise a page response by surfacing the URL at the top level.
 *
 * Notion page responses bury the URL inside the full response body. This
 * wrapper lifts it for easier consumption by agents.
 *
 * @param response - Raw Notion page API response.
 * @returns Object with `url` at the top and the full `response` nested.
 */
export function wrapPageResponse(response: LooseRecord & { url?: string | null }) {
  return {
    url: response.url ?? null,
    response,
  };
}
