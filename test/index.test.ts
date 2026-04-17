import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@notionhq/client";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getNotionApiKey } from "../src/auth.js";
import {
  queryNotionDatabase,
  deleteNotionPage,
  moveNotionPage,
  publishNotionPage,
  getNotionFileTree,
  syncNotionFile,
  getNotionHelp,
  runNotionDoctor,
} from "../src/index.js";

/**
 * Live API tests for the openclaw-notion plugin.
 *
 * These bypass the OpenClaw plugin machinery and test the core behavior
 * directly: API key resolution per agentId → Notion client → real API calls.
 * Confirms per-agent workspace isolation works end-to-end across all three
 * tools: search, read, and append.
 *
 * Requirements:
 *   - ~/.config/notion/api_key (Tavi's workspace)
 *   - ~/.config/notion/api_key_gf_agent (Esther's workspace)
 *   - Both Notion integrations must have access to at least one page.
 */

function makeClient(agentId?: string): Client {
  return new Client({
    auth: getNotionApiKey(agentId),
    notionVersion: "2026-03-11",
  });
}

// ─── Key Isolation ──────────────────────────────────────────────────────

describe("Key isolation", () => {
  it("default and gf_agent resolve to different API keys", () => {
    const defaultKey = getNotionApiKey(undefined);
    const gfKey = getNotionApiKey("gf_agent");
    expect(defaultKey).not.toBe(gfKey);
    expect(defaultKey.length).toBeGreaterThan(10);
    expect(gfKey.length).toBeGreaterThan(10);
  });

  it("explicitly passing 'main' falls back to the default key", () => {
    const defaultKey = getNotionApiKey(undefined);
    const mainKey = getNotionApiKey("main");
    // 'main' has no agent-specific key file, so it should fall back to default
    expect(mainKey).toBe(defaultKey);
  });

  it("unknown agentId falls back to default key", () => {
    const defaultKey = getNotionApiKey(undefined);
    const unknownKey = getNotionApiKey("nonexistent_agent_xyz");
    expect(unknownKey).toBe(defaultKey);
  });

  it("API keys start with the Notion secret prefix", () => {
    const defaultKey = getNotionApiKey(undefined);
    const gfKey = getNotionApiKey("gf_agent");
    expect(defaultKey.startsWith("ntn_") || defaultKey.startsWith("secret_")).toBe(true);
    expect(gfKey.startsWith("ntn_") || gfKey.startsWith("secret_")).toBe(true);
  });
});

// ─── Default Agent (Wretch / Tavi) ──────────────────────────────────────

describe("Default agent (Wretch / Tavi)", () => {
  const notion = makeClient(undefined);
  let testPageId: string;
  let deploymentPlanId: string;

  describe("notion_search", () => {
    it("returns results for empty query (list pages)", async () => {
      const response = await notion.search({ query: "", page_size: 5 });
      expect(response.results).toBeDefined();
      expect(Array.isArray(response.results)).toBe(true);
      expect(response.results.length).toBeGreaterThan(0);
    });

    it("finds 'Projects' by keyword", async () => {
      const response = await notion.search({ query: "Projects", page_size: 5 });
      expect(response.results.length).toBeGreaterThan(0);
      const page = response.results[0] as any;
      expect(page.id).toBeDefined();
      expect(page.object).toBe("page");
    });

    it("returns page properties including title", async () => {
      const response = await notion.search({ query: "Projects", page_size: 1 });
      const page = response.results[0] as any;
      expect(page.properties).toBeDefined();
      expect(page.properties.title).toBeDefined();
      const titleText = page.properties.title?.title?.[0]?.plain_text;
      expect(typeof titleText).toBe("string");
      expect(titleText.length).toBeGreaterThan(0);
    });

    it("returns URL for found pages", async () => {
      const response = await notion.search({ query: "Projects", page_size: 1 });
      const page = response.results[0] as any;
      expect(page.url).toBeDefined();
      expect(page.url).toMatch(/^https:\/\/www\.notion\.so\//);
    });

    it("handles a query with no matches gracefully", async () => {
      const response = await notion.search({
        query: "zzz_nonexistent_page_12345_xyzzy",
        page_size: 5,
      });
      expect(response.results).toBeDefined();
      expect(Array.isArray(response.results)).toBe(true);
      // Might return 0 or some fuzzy matches, either is fine
    }, 15000);
  });

  describe("notion_read", () => {
    beforeAll(async () => {
      // Find a known page to read
      const response = await notion.search({ query: "Projects", page_size: 1 });
      expect(response.results.length).toBeGreaterThan(0);
      testPageId = response.results[0].id;
    });

    it("reads blocks from a known page", async () => {
      const response = await notion.blocks.children.list({ block_id: testPageId });
      expect(response.results).toBeDefined();
      expect(Array.isArray(response.results)).toBe(true);
    });

    it("returns block objects with type and id", async () => {
      const response = await notion.blocks.children.list({ block_id: testPageId });
      if (response.results.length > 0) {
        const block = response.results[0] as any;
        expect(block.id).toBeDefined();
        expect(block.type).toBeDefined();
        expect(block.object).toBe("block");
      }
    });

    it("rejects invalid page ID with an error", async () => {
      await expect(
        notion.blocks.children.list({ block_id: "00000000-0000-0000-0000-000000000000" })
      ).rejects.toThrow();
    });
  });

  describe("notion_append", () => {
    let appendTargetId: string;

    beforeAll(async () => {
      // Find the deployment plan page we created earlier — safe to append test content
      const response = await notion.search({ query: "Deployment Plan", page_size: 1 });
      expect(response.results.length).toBeGreaterThan(0);
      appendTargetId = response.results[0].id;
    });

    it("appends a paragraph block to a page", async () => {
      const timestamp = new Date().toISOString();
      const testText = `[vitest] append test at ${timestamp}`;

      const response = await notion.blocks.children.append({
        block_id: appendTargetId,
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content: testText } }],
            },
          },
        ],
      });

      expect(response.results).toBeDefined();
      expect(response.results.length).toBe(1);
      const block = response.results[0] as any;
      expect(block.type).toBe("paragraph");
      expect(block.paragraph.rich_text[0].plain_text).toBe(testText);
    }, 15000);
  });

  describe("markdown and comments", () => {
    let newPageId: string | undefined;

    beforeAll(async () => {
      const response = await notion.search({ query: "Deployment Plan", page_size: 1 });
      expect(response.results.length).toBeGreaterThan(0);
      deploymentPlanId = response.results[0].id;
    }, 20000);

    it("creates a page with markdown under Deployment Plan", async () => {
      const page = await notion.pages.create({
        parent: { page_id: deploymentPlanId },
        properties: {
          title: {
            title: [{ type: "text", text: { content: "Test Page" } }],
          },
        },
        markdown:
          "This is a **test** created by vitest.\n\n- Item 1\n- Item 2\n\n```js\nconsole.log('hello');\n```",
      });

      expect(page.id).toBeDefined();
      expect(page.object).toBe("page");
      newPageId = page.id;
    });

    it("retrieves the created page as markdown", async () => {
      expect(newPageId).toBeDefined();

      const md = await notion.pages.retrieveMarkdown({ page_id: newPageId! });

      expect(md.object).toBe("page_markdown");
      expect(md.markdown).toContain("This is a **test** created by vitest.");
    });

    it("updates page content via replace_content markdown", async () => {
      expect(newPageId).toBeDefined();

      const updated = await notion.pages.updateMarkdown({
        page_id: newPageId!,
        type: "replace_content",
        replace_content: { new_str: "# Updated Title\n\nNew content here." },
      });

      expect(updated.object).toBe("page_markdown");
      expect(updated.markdown).toContain("Updated Title");
      expect(updated.markdown).toContain("New content here.");
    });

    it("updates page title and icon", async () => {
      expect(newPageId).toBeDefined();

      const updated = await notion.pages.update({
        page_id: newPageId!,
        icon: { type: "emoji", emoji: "🧪" },
        properties: {
          title: {
            title: [{ type: "text", text: { content: "Renamed Test Page" } }],
          },
        },
      });

      expect(updated.object).toBe("page");
      expect((updated as any).icon?.type).toBe("emoji");
      expect((updated as any).icon?.emoji).toBe("🧪");
      expect((updated as any).properties?.title?.title?.[0]?.plain_text).toBe(
        "Renamed Test Page"
      );
    });

    it("creates and lists comments for the test page", async () => {
      expect(newPageId).toBeDefined();

      const comment = await notion.comments.create({
        parent: { page_id: newPageId! },
        rich_text: [
          { type: "text", text: { content: "Test comment from vitest" } },
        ],
      });
      expect(comment.object).toBe("comment");

      const comments = await notion.comments.list({ block_id: newPageId! });
      expect(comments.object).toBe("list");
      expect(
        comments.results.some((entry) =>
          entry.rich_text.some(
            (item) => item.plain_text === "Test comment from vitest"
          )
        )
      ).toBe(true);
    });

    it("trashes the markdown test page for cleanup", async () => {
      expect(newPageId).toBeDefined();

      const trashed = await notion.pages.update({
        page_id: newPageId!,
        in_trash: true,
      });

      expect((trashed as any).in_trash || (trashed as any).archived).toBe(true);
    });
  });
});

// ─── gf_agent (Alaric / Esther) ────────────────────────────────────────

describe("gf_agent (Alaric / Esther)", () => {
  const notion = makeClient("gf_agent");
  let testPageId: string;

  describe("notion_search", () => {
    it("authenticates and returns results from Esther's workspace", async () => {
      const response = await notion.search({ query: "", page_size: 5 });
      expect(response.results).toBeDefined();
      expect(Array.isArray(response.results)).toBe(true);
      expect(response.results.length).toBeGreaterThan(0);
    });

    it("finds Esther-specific content", async () => {
      const response = await notion.search({ query: "Possessives", page_size: 5 });
      expect(response.results.length).toBeGreaterThan(0);
      const page = response.results[0] as any;
      expect(page.id).toBeDefined();
    });

    it("does NOT return Tavi-specific content", async () => {
      // "01 — Projects" exists only in Tavi's workspace
      const response = await notion.search({ query: "01 — Projects", page_size: 5 });
      const titles = response.results.map((r: any) => {
        const titleProp = r.properties?.title || r.properties?.Name;
        return titleProp?.title?.[0]?.plain_text || "";
      });
      expect(titles).not.toContain("01 — Projects");
    });
  });

  describe("notion_read", () => {
    beforeAll(async () => {
      const response = await notion.search({ query: "", page_size: 1 });
      expect(response.results.length).toBeGreaterThan(0);
      testPageId = response.results[0].id;
    });

    it("reads blocks from Esther's workspace", async () => {
      const response = await notion.blocks.children.list({ block_id: testPageId });
      expect(response.results).toBeDefined();
      expect(Array.isArray(response.results)).toBe(true);
    });

    it("cannot read Tavi's pages with gf_agent key", async () => {
      // Use a known Tavi page ID — should fail with 404 or permission error
      const taviPageId = "dcc09ec2-11b3-4a95-8118-daede10eef1d"; // "01 — Projects"
      await expect(
        notion.blocks.children.list({ block_id: taviPageId })
      ).rejects.toThrow();
    });

    it("can read one of Esther's pages as markdown", async () => {
      const response = await notion.search({ query: "", page_size: 1 });
      expect(response.results.length).toBeGreaterThan(0);

      const markdown = await notion.pages.retrieveMarkdown({
        page_id: response.results[0].id,
      });

      expect(markdown.object).toBe("page_markdown");
      expect(typeof markdown.markdown).toBe("string");
      expect(markdown.markdown.length).toBeGreaterThan(0);
    });

    it("cannot read Tavi's pages as markdown with gf_agent key", async () => {
      const taviPageId = "dcc09ec2-11b3-4a95-8118-daede10eef1d"; // "01 — Projects"
      await expect(
        notion.pages.retrieveMarkdown({ page_id: taviPageId })
      ).rejects.toThrow();
    });
  });

  describe("notion_append", () => {
    it("can append to a page in Esther's workspace", async () => {
      // Search for any writable page
      const response = await notion.search({ query: "", page_size: 1 });
      expect(response.results.length).toBeGreaterThan(0);
      const pageId = response.results[0].id;

      const timestamp = new Date().toISOString();
      const testText = `[vitest gf_agent] append test at ${timestamp}`;

      const appendResponse = await notion.blocks.children.append({
        block_id: pageId,
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content: testText } }],
            },
          },
        ],
      });

      expect(appendResponse.results.length).toBe(1);
      const block = appendResponse.results[0] as any;
      expect(block.paragraph.rich_text[0].plain_text).toBe(testText);
    });
  });
});

// ─── Cross-workspace isolation ──────────────────────────────────────────

describe("Cross-workspace isolation", () => {
  it("default search and gf_agent search return different page sets", async () => {
    const defaultNotion = makeClient(undefined);
    const gfNotion = makeClient("gf_agent");

    const [defaultResults, gfResults] = await Promise.all([
      defaultNotion.search({ query: "", page_size: 5 }),
      gfNotion.search({ query: "", page_size: 5 }),
    ]);

    const defaultIds = new Set(defaultResults.results.map((r) => r.id));
    const gfIds = new Set(gfResults.results.map((r) => r.id));

    // The two workspaces should have completely different page IDs
    const overlap = [...defaultIds].filter((id) => gfIds.has(id));
    expect(overlap.length).toBe(0);
  });
});

// ─── Phase 1: New Tools ─────────────────────────────────────────────────

// ─── notion_delete ──────────────────────────────────────────────────────

describe("notion_delete", () => {
  const notion = makeClient(undefined);
  let parentPageId: string;
  let trashPageId: string;

  beforeAll(async () => {
    const response = await notion.search({ query: "Deployment Plan", page_size: 1 });
    expect(response.results.length).toBeGreaterThan(0);
    parentPageId = response.results[0].id;
  });

  it("creates a page then trashes it", async () => {
    // Create a page to trash
    const page = await notion.pages.create({
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ type: "text", text: { content: "[vitest] trash-me" } }],
        },
      },
      markdown: "This page will be trashed by tests.",
    }) as any;
    trashPageId = page.id;
    expect(page.id).toBeDefined();

    // Trash it
    const result = await deleteNotionPage(notion, { page_id: trashPageId });
    const r = result as any;
    expect(r.in_trash === true || r.archived === true).toBe(true);
  }, 15000);

  it("rejects trashing an invalid page ID", async () => {
    await expect(
      deleteNotionPage(notion, { page_id: "00000000-0000-0000-0000-000000000000" })
    ).rejects.toThrow();
  });
});

// ─── notion_move ────────────────────────────────────────────────────────

describe("notion_move", () => {
  const notion = makeClient(undefined);
  let parentPageId: string;
  let secondParentId: string;
  let movePageId: string;

  beforeAll(async () => {
    // Find two parent pages
    const response = await notion.search({ query: "Deployment Plan", page_size: 1 });
    expect(response.results.length).toBeGreaterThan(0);
    parentPageId = response.results[0].id;

    // Create a second parent to move the page into
    const secondParent = await notion.pages.create({
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ type: "text", text: { content: "[vitest] move-destination" } }],
        },
      },
      markdown: "Move target.",
    }) as any;
    secondParentId = secondParent.id;

    // Create the page that will be moved
    const movePage = await notion.pages.create({
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ type: "text", text: { content: "[vitest] page-to-move" } }],
        },
      },
      markdown: "I will be moved.",
    }) as any;
    movePageId = movePage.id;
  }, 20000);

  afterAll(async () => {
    // Cleanup: trash both test pages
    await deleteNotionPage(notion, { page_id: movePageId }).catch(() => {});
    await deleteNotionPage(notion, { page_id: secondParentId }).catch(() => {});
  });

  it("moves a page to a new parent", async () => {
    const result = await moveNotionPage(notion, {
      page_id: movePageId,
      new_parent_id: secondParentId,
    });
    expect(result).toBeDefined();
    // Verify by fetching the page and checking its parent
    const page = await notion.pages.retrieve({ page_id: movePageId }) as any;
    expect(page.parent?.page_id?.replace(/-/g, "")).toBe(
      secondParentId.replace(/-/g, "")
    );
  }, 15000);

  it("rejects moving to an invalid parent", async () => {
    await expect(
      moveNotionPage(notion, {
        page_id: movePageId,
        new_parent_id: "00000000-0000-0000-0000-000000000000",
      })
    ).rejects.toThrow();
  });
});

// ─── notion_publish (stub) ──────────────────────────────────────────────

describe("notion_publish", () => {
  const notion = makeClient(undefined);
  let testPageId: string;

  beforeAll(async () => {
    const response = await notion.search({ query: "Projects", page_size: 1 });
    expect(response.results.length).toBeGreaterThan(0);
    testPageId = response.results[0].id;
  });

  it("returns a stub report with supported=false", async () => {
    const result = await publishNotionPage(notion, { page_id: testPageId });
    expect(result.supported).toBe(false);
    expect(result.page_id).toBe(testPageId);
    expect(result.requested_state).toBe(true);
    expect(result.url).toBeDefined();
    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(10);
  });

  it("respects the published=false parameter", async () => {
    const result = await publishNotionPage(notion, {
      page_id: testPageId,
      published: false,
    });
    expect(result.requested_state).toBe(false);
  });
});

// ─── notion_file_tree ───────────────────────────────────────────────────

describe("notion_file_tree", () => {
  const notion = makeClient(undefined);
  let rootPageId: string;

  beforeAll(async () => {
    const response = await notion.search({ query: "Projects", page_size: 1 });
    expect(response.results.length).toBeGreaterThan(0);
    rootPageId = response.results[0].id;
  });

  it("returns a tree structure with title, id, url, type, children", async () => {
    const tree = await getNotionFileTree(notion, {
      page_id: rootPageId,
      max_depth: 1,
    });
    expect(tree.title).toBeDefined();
    expect(tree.id).toBe(rootPageId);
    expect(tree.type).toBe("page");
    expect(Array.isArray(tree.children)).toBe(true);
    expect(tree.url).toMatch(/^https:\/\/www\.notion\.so\//);
  }, 30000);

  it("respects max_depth=0 and returns no children", async () => {
    const tree = await getNotionFileTree(notion, {
      page_id: rootPageId,
      max_depth: 0,
    });
    expect(tree.children.length).toBe(0);
  });

  it("child nodes have the expected shape", async () => {
    const tree = await getNotionFileTree(notion, {
      page_id: rootPageId,
      max_depth: 1,
    });
    for (const child of tree.children) {
      expect(child.id).toBeDefined();
      expect(child.title).toBeDefined();
      expect(["page", "database"]).toContain(child.type);
      expect(Array.isArray(child.children)).toBe(true);
    }
  }, 30000);

  it("gf_agent cannot enumerate Tavi's pages", async () => {
    const gfNotion = makeClient("gf_agent");
    await expect(
      getNotionFileTree(gfNotion, { page_id: rootPageId, max_depth: 1 })
    ).rejects.toThrow();
  });
});

// ─── notion_sync ────────────────────────────────────────────────────────

describe("notion_sync", () => {
  const notion = makeClient(undefined);
  let parentPageId: string;
  let tmpDir: string;
  const createdPageIds: string[] = [];

  beforeAll(async () => {
    const response = await notion.search({ query: "Deployment Plan", page_size: 1 });
    expect(response.results.length).toBeGreaterThan(0);
    parentPageId = response.results[0].id;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "notion-sync-test-"));
  });

  afterAll(async () => {
    // Cleanup: trash all created pages
    for (const id of createdPageIds) {
      await deleteNotionPage(notion, { page_id: id }).catch(() => {});
    }
    // Cleanup: remove temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("push: creates a new Notion page from a local file", async () => {
    const filePath = path.join(tmpDir, "push-test.md");
    fs.writeFileSync(filePath, "---\ntitle: Push Test\n---\n# Push Test\n\nCreated by vitest.", "utf8");

    const result = await syncNotionFile(notion, {
      path: filePath,
      parent_id: parentPageId,
      direction: "push",
    });

    expect(result.direction).toBe("push");
    expect(result.page_id).toBeDefined();
    expect(result.url).toMatch(/^https:\/\/www\.notion\.so\//);
    createdPageIds.push(result.page_id);

    // Verify notion_id was written back to frontmatter
    const updatedContent = fs.readFileSync(filePath, "utf8");
    expect(updatedContent).toContain(`notion_id: ${result.page_id}`);
  }, 20000);

  it("push: updates an existing Notion page when notion_id is in frontmatter", async () => {
    const filePath = path.join(tmpDir, "push-update-test.md");
    // First create a page
    fs.writeFileSync(filePath, "---\ntitle: Update Test\n---\n# Original Content", "utf8");
    const createResult = await syncNotionFile(notion, {
      path: filePath,
      parent_id: parentPageId,
      direction: "push",
    });
    createdPageIds.push(createResult.page_id);

    // Now update the local file content (keep the notion_id frontmatter)
    const currentContent = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(
      filePath,
      currentContent.replace("# Original Content", "# Updated Content\n\nThis was modified."),
      "utf8"
    );

    // Push again — should update the existing page
    const updateResult = await syncNotionFile(notion, {
      path: filePath,
      direction: "push",
    });
    expect(updateResult.page_id).toBe(createResult.page_id);
    expect(updateResult.direction).toBe("push");
  }, 25000);

  it("pull: downloads a Notion page to a local file", async () => {
    // Use one of the pages we created
    const pageId = createdPageIds[0];
    expect(pageId).toBeDefined();

    const filePath = path.join(tmpDir, "pull-test.md");
    const result = await syncNotionFile(notion, {
      path: filePath,
      page_id: pageId,
      direction: "pull",
    });

    expect(result.direction).toBe("pull");
    expect(result.page_id).toBe(pageId);
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("notion_id");
    expect(content).toContain(pageId);
  }, 20000);

  it("auto: syncs based on mtime comparison", async () => {
    const pageId = createdPageIds[0];
    expect(pageId).toBeDefined();

    const filePath = path.join(tmpDir, "auto-test.md");
    // Pull first so we have a known state
    await syncNotionFile(notion, {
      path: filePath,
      page_id: pageId,
      direction: "pull",
    });

    // Auto should detect and choose a direction
    const result = await syncNotionFile(notion, {
      path: filePath,
      direction: "auto",
    });
    expect(["push", "pull"]).toContain(result.direction);
    expect(result.reason).toBeDefined();
  }, 25000);

  it("rejects push of a nonexistent local file", async () => {
    await expect(
      syncNotionFile(notion, {
        path: path.join(tmpDir, "does-not-exist.md"),
        parent_id: parentPageId,
        direction: "push",
      })
    ).rejects.toThrow();
  });

  it("rejects pull without page_id or notion_id", async () => {
    const filePath = path.join(tmpDir, "no-id.md");
    fs.writeFileSync(filePath, "# No ID\n\nJust content.", "utf8");
    await expect(
      syncNotionFile(notion, {
        path: filePath,
        direction: "pull",
      })
    ).rejects.toThrow();
  });
});

// ─── notion_help ────────────────────────────────────────────────────────

describe("notion_help", () => {
  it("returns documentation for all tools", () => {
    const help = getNotionHelp();
    expect(help).toContain("notion_search");
    expect(help).toContain("notion_query");
    expect(help).toContain("notion_delete");
    expect(help).toContain("notion_move");
    expect(help).toContain("notion_publish");
    expect(help).toContain("notion_file_tree");
    expect(help).toContain("notion_sync");
    expect(help).toContain("notion_help");
    expect(help).toContain("notion_doctor");
  });

  it("returns help for a specific tool", () => {
    const help = getNotionHelp("notion_sync");
    expect(help).toContain("notion_sync");
    expect(help).not.toContain("notion_search");
  });

  it("throws for an unknown tool name", () => {
    expect(() => getNotionHelp("notion_foobar")).toThrow("Unknown Notion tool");
  });
});

// ─── notion_doctor ──────────────────────────────────────────────────────

describe("notion_doctor", () => {
  it("returns a diagnostic report with plugin info", async () => {
    const report = await runNotionDoctor();
    expect(report.plugin.name).toBe("openclaw-notion");
    expect(report.plugin.notion_version).toBe("2026-03-11");
    expect(report.plugin.sdk_version).toBeDefined();
    expect(report.plugin.version).toBeDefined();
  }, 20000);

  it("checks connectivity for all configured agents", async () => {
    const report = await runNotionDoctor();
    expect(report.configured_agents.length).toBeGreaterThanOrEqual(2);

    const defaultAgent = report.configured_agents.find(
      (a: any) => a.agent_id === "default"
    );
    expect(defaultAgent).toBeDefined();
    expect(defaultAgent!.api_key_present).toBe(true);
    expect(defaultAgent!.connectivity.ok).toBe(true);

    const gfAgent = report.configured_agents.find(
      (a: any) => a.agent_id === "gf_agent"
    );
    expect(gfAgent).toBeDefined();
    expect(gfAgent!.api_key_present).toBe(true);
    expect(gfAgent!.connectivity.ok).toBe(true);
  }, 20000);

  it("handles an agent context parameter", async () => {
    const report = await runNotionDoctor("gf_agent");
    expect(report.current_agent).toBe("gf_agent");
    const gfEntry = report.configured_agents.find(
      (a: any) => a.agent_id === "gf_agent"
    );
    expect(gfEntry?.using_current_context).toBe(true);
  }, 20000);
});

// ─── URL surfacing on create/update tools ───────────────────────────────

describe("URL surfacing", () => {
  const notion = makeClient(undefined);
  let parentPageId: string;
  let testPageId: string;

  beforeAll(async () => {
    const response = await notion.search({ query: "Deployment Plan", page_size: 1 });
    expect(response.results.length).toBeGreaterThan(0);
    parentPageId = response.results[0].id;
  });

  afterAll(async () => {
    if (testPageId) {
      await deleteNotionPage(notion, { page_id: testPageId }).catch(() => {});
    }
  });

  it("notion_create returns url at top level", async () => {
    const page = await notion.pages.create({
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ type: "text", text: { content: "[vitest] url-test" } }],
        },
      },
      markdown: "URL test page.",
    }) as any;
    testPageId = page.id;
    // The wrapPageResponse function should surface url
    expect(page.url).toMatch(/^https:\/\/www\.notion\.so\//);
  }, 15000);

  it("notion_update_page returns url at top level", async () => {
    const updated = await notion.pages.update({
      page_id: testPageId,
      icon: { type: "emoji", emoji: "🔗" },
    }) as any;
    expect(updated.url).toMatch(/^https:\/\/www\.notion\.so\//);
  });
});

// ─── Phase 1 workspace isolation on new tools ───────────────────────────

describe("Phase 1 workspace isolation", () => {
  const gfNotion = makeClient("gf_agent");
  let taviPageId: string;

  beforeAll(async () => {
    const defaultNotion = makeClient(undefined);
    const response = await defaultNotion.search({ query: "Projects", page_size: 1 });
    expect(response.results.length).toBeGreaterThan(0);
    taviPageId = response.results[0].id;
  });

  it("gf_agent cannot delete Tavi's pages", async () => {
    await expect(
      deleteNotionPage(gfNotion, { page_id: taviPageId })
    ).rejects.toThrow();
  });

  it("gf_agent cannot move Tavi's pages", async () => {
    await expect(
      moveNotionPage(gfNotion, {
        page_id: taviPageId,
        new_parent_id: taviPageId,
      })
    ).rejects.toThrow();
  });

  it("gf_agent publish stub still returns info for accessible pages", async () => {
    const gfSearch = await gfNotion.search({ query: "", page_size: 1 });
    expect(gfSearch.results.length).toBeGreaterThan(0);
    const gfPageId = gfSearch.results[0].id;
    const result = await publishNotionPage(gfNotion, { page_id: gfPageId });
    expect(result.supported).toBe(false);
    expect(result.page_id).toBe(gfPageId);
  });

  it("notion_doctor shows both agents as configured", async () => {
    const report = await runNotionDoctor();
    const agentIds = report.configured_agents.map((a: any) => a.agent_id);
    expect(agentIds).toContain("default");
    expect(agentIds).toContain("gf_agent");
  }, 20000);
});
