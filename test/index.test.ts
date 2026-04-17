import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@notionhq/client";
import { getNotionApiKey } from "../src/auth.js";

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
