import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteNotionPage, syncNotionFile } from "../src/index.js";
import { makeClient } from "./helpers.js";

describe("notion_sync", () => {
  const notion = makeClient(undefined);
  const createdPageIds: string[] = [];
  let parentPageId: string;
  let tmpDir: string;

  beforeAll(async () => {
    parentPageId = (await notion.search({ query: "Deployment Plan", page_size: 1 })).results[0].id;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notion-sync-test-"));
  });

  afterAll(async () => {
    for (const id of createdPageIds) {
      await deleteNotionPage(notion, { page_id: id }).catch(() => {});
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("push: creates a new Notion page from a local file", async () => {
    const filePath = path.join(tmpDir, "push-test.md");
    fs.writeFileSync(
      filePath,
      `---
title: Push Test
---
# Push Test

Created by vitest.`,
      "utf8",
    );

    const result = await syncNotionFile(notion, {
      path: filePath,
      parent_id: parentPageId,
      direction: "push",
    });

    createdPageIds.push(result.page_id);
    expect(result.direction).toBe("push");
    expect(result.url).toMatch(/^https:\/\/www\.notion\.so\//);
    expect(fs.readFileSync(filePath, "utf8")).toContain(`notion_id: ${result.page_id}`);
  }, 20000);

  it("push: updates an existing Notion page when notion_id is in frontmatter", async () => {
    const filePath = path.join(tmpDir, "push-update-test.md");
    fs.writeFileSync(
      filePath,
      `---
title: Update Test
---
# Original Content`,
      "utf8",
    );

    const createResult = await syncNotionFile(notion, {
      path: filePath,
      parent_id: parentPageId,
      direction: "push",
    });
    createdPageIds.push(createResult.page_id);

    fs.writeFileSync(
      filePath,
      fs.readFileSync(filePath, "utf8").replace(
        "# Original Content",
        `# Updated Content

This was modified.`,
      ),
      "utf8",
    );

    const updateResult = await syncNotionFile(notion, { path: filePath, direction: "push" });
    expect(updateResult.page_id).toBe(createResult.page_id);
    expect(updateResult.direction).toBe("push");
  }, 25000);

  it("pull: downloads a Notion page to a local file", async () => {
    const filePath = path.join(tmpDir, "pull-test.md");
    const pageId = createdPageIds[0];

    const result = await syncNotionFile(notion, {
      path: filePath,
      page_id: pageId,
      direction: "pull",
    });

    expect(result.direction).toBe("pull");
    expect(result.page_id).toBe(pageId);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toContain(pageId);
  }, 20000);

  it("auto: syncs based on mtime comparison", async () => {
    const filePath = path.join(tmpDir, "auto-test.md");
    await syncNotionFile(notion, {
      path: filePath,
      page_id: createdPageIds[0],
      direction: "pull",
    });
    const result = await syncNotionFile(notion, { path: filePath, direction: "auto" });
    expect(["push", "pull"]).toContain(result.direction);
    expect(result.reason).toBeDefined();
  }, 25000);

  it("rejects push of a nonexistent local file", async () => {
    await expect(
      syncNotionFile(notion, {
        path: path.join(tmpDir, "does-not-exist.md"),
        parent_id: parentPageId,
        direction: "push",
      }),
    ).rejects.toThrow();
  });

  it("rejects pull without page_id or notion_id", async () => {
    const filePath = path.join(tmpDir, "no-id.md");
    fs.writeFileSync(
      filePath,
      `# No ID

Just content.`,
      "utf8",
    );
    await expect(syncNotionFile(notion, { path: filePath, direction: "pull" })).rejects.toThrow();
  });
});
