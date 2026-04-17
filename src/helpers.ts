/**
 * Shared helper functions for Notion data extraction and metadata access.
 *
 * These utilities handle the messy reality of Notion's response types:
 * extracting titles from various property shapes, resolving page and
 * database metadata, and reading local package versions for diagnostics.
 */

import * as fs from 'node:fs';
import type { Client } from '@notionhq/client';
import type { AnyDatabase, AnyPage, LooseRecord } from './types.js';

/**
 * Type guard that narrows `unknown` to a non-null record.
 *
 * @param value - Value to check.
 * @returns `true` when `value` is a non-null object.
 */
export function isRecord(value: unknown): value is LooseRecord {
  return typeof value === 'object' && value !== null;
}

/**
 * Join an array of Notion rich-text items into a single plain string.
 *
 * @param value - Array of rich-text objects (each with `plain_text`).
 * @returns The concatenated text, or `null` when the input is not an array
 *   or the result is empty.
 */
export function extractPlainText(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const text = value
    .map((item) => (isRecord(item) && typeof item.plain_text === 'string' ? item.plain_text : ''))
    .join('')
    .trim();
  return text || null;
}

/**
 * Scan a page's `properties` object for the property whose type is `"title"`.
 *
 * Notion pages always have exactly one title property, but its key name varies
 * (commonly `"title"`, `"Name"`, or a user-defined label).
 *
 * @param properties - The `properties` object from a Notion page response.
 * @returns The property key name, or `null` when not found.
 */
export function findTitlePropertyName(properties: unknown): string | null {
  if (!isRecord(properties)) {
    return null;
  }
  for (const [name, value] of Object.entries(properties)) {
    if (isRecord(value) && value.type === 'title') {
      return name;
    }
  }
  return null;
}

/**
 * Best-effort title extraction from a page or database object.
 *
 * Handles three shapes:
 * 1. Top-level `title` array (databases)
 * 2. `properties.{titleProp}.title` array (pages)
 * 3. Falls back to `"Untitled"`
 *
 * @param page - A loosely-typed Notion page or database object.
 * @returns The extracted title string.
 */
export function extractPageTitle(page: unknown): string {
  if (!isRecord(page)) {
    return 'Untitled';
  }
  if (Array.isArray(page.title)) {
    return extractPlainText(page.title) ?? 'Untitled';
  }
  const titleProperty = findTitlePropertyName(page.properties);
  if (titleProperty && isRecord(page.properties) && isRecord(page.properties[titleProperty])) {
    return extractPlainText(page.properties[titleProperty].title) ?? 'Untitled';
  }
  return 'Untitled';
}

/**
 * Check whether a query error should trigger a fallback to the
 * `dataSources.query` endpoint.
 *
 * The Notion API returns `object_not_found` or `validation_error` when a
 * UUID points to a data source rather than a classic database.
 *
 * @param error - The caught error object.
 * @returns `true` when the error code indicates a fallback is worth trying.
 */
export function shouldFallbackQuery(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  return (
    typeof error.code === 'string' && ['object_not_found', 'validation_error'].includes(error.code)
  );
}

/**
 * Fetch full page metadata from the Notion API.
 *
 * @param notion - Authenticated Notion client.
 * @param pageId - UUID of the page.
 * @returns The page object cast to {@link AnyPage}.
 */
export async function retrievePageMetadata(notion: Client, pageId: string): Promise<AnyPage> {
  return notion.pages.retrieve({ page_id: pageId }) as Promise<AnyPage>;
}

/**
 * Fetch full database metadata from the Notion API.
 *
 * @param notion - Authenticated Notion client.
 * @param databaseId - UUID of the database.
 * @returns The database object cast to {@link AnyDatabase}.
 */
export async function retrieveDatabaseMetadata(
  notion: Client,
  databaseId: string
): Promise<AnyDatabase> {
  return notion.databases.retrieve({ database_id: databaseId }) as Promise<AnyDatabase>;
}

/**
 * Read version metadata from the plugin's own `package.json` and the
 * installed Notion SDK `package.json`.
 *
 * @returns Object with `pluginName`, `pluginVersion`, and `sdkVersion`.
 */
export function getPackageMetadata() {
  const pluginPackage = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as { name?: string; version?: string };
  const sdkPackage = JSON.parse(
    fs.readFileSync(
      new URL('../node_modules/@notionhq/client/package.json', import.meta.url),
      'utf8'
    )
  ) as { version?: string };

  return {
    pluginName: pluginPackage.name ?? 'openclaw-notion',
    pluginVersion: pluginPackage.version ?? 'unknown',
    sdkVersion: sdkPackage.version ?? 'unknown',
  };
}
