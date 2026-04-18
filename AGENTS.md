# AGENTS.md

Rules for AI agents working on this codebase.

## Tests

Tests run against a live Notion workspace. The workspace contains real pages that belong to the user.

**Never modify, update, delete, move, or write to existing workspace pages.** This applies at every stage of testing: setup, execution, teardown, and error recovery. Existing pages are read-only. You may search them and read them. Nothing else.

Tests must be fully self-contained:

- Create any pages, databases, or blocks you need at the start of the test.
- Run assertions against the pages you created.
- Delete everything you created when the test finishes, including on failure (use `afterAll`/`afterEach` cleanup).
- If cleanup fails, leave the orphaned pages rather than retrying destructive operations on pages you didn't create.

If a test needs a page with specific properties (title, icon, content, children), create that page from scratch. Do not repurpose or "borrow" an existing page even temporarily.

## Code style

- All exports need TSDoc docstrings.
- Comments explain *why*, not *what*.
- Run `biome check --write` before committing.
- Run `tsc --noEmit` before pushing.
