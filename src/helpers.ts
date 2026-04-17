import * as fs from "node:fs";
import type { Client } from "@notionhq/client";
import type { AnyDatabase, AnyPage, LooseRecord } from "./types.js";

export function isRecord(value: unknown): value is LooseRecord {
  return typeof value === "object" && value !== null;
}

export function extractPlainText(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const text = value
    .map((item) => (isRecord(item) && typeof item.plain_text === "string" ? item.plain_text : ""))
    .join("")
    .trim();
  return text || null;
}

export function findTitlePropertyName(properties: unknown): string | null {
  if (!isRecord(properties)) {
    return null;
  }
  for (const [name, value] of Object.entries(properties)) {
    if (isRecord(value) && value.type === "title") {
      return name;
    }
  }
  return null;
}

export function extractPageTitle(page: unknown): string {
  if (!isRecord(page)) {
    return "Untitled";
  }
  if (Array.isArray(page.title)) {
    return extractPlainText(page.title) ?? "Untitled";
  }
  const titleProperty = findTitlePropertyName(page.properties);
  if (titleProperty && isRecord(page.properties) && isRecord(page.properties[titleProperty])) {
    return extractPlainText(page.properties[titleProperty].title) ?? "Untitled";
  }
  return "Untitled";
}

export function shouldFallbackQuery(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  return (
    typeof error.code === "string" && ["object_not_found", "validation_error"].includes(error.code)
  );
}

export async function retrievePageMetadata(notion: Client, pageId: string): Promise<AnyPage> {
  return notion.pages.retrieve({ page_id: pageId }) as Promise<AnyPage>;
}

export async function retrieveDatabaseMetadata(
  notion: Client,
  databaseId: string,
): Promise<AnyDatabase> {
  return notion.databases.retrieve({ database_id: databaseId }) as Promise<AnyDatabase>;
}

export function getPackageMetadata() {
  const pluginPackage = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { name?: string; version?: string };
  const sdkPackage = JSON.parse(
    fs.readFileSync(
      new URL("../node_modules/@notionhq/client/package.json", import.meta.url),
      "utf8",
    ),
  ) as { version?: string };

  return {
    pluginName: pluginPackage.name ?? "openclaw-notion",
    pluginVersion: pluginPackage.version ?? "unknown",
    sdkVersion: sdkPackage.version ?? "unknown",
  };
}
