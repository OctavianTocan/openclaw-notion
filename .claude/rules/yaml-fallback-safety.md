# YAML fallback must preserve identity fields

When catching YAML parse errors to fall back gracefully, always attempt
best-effort extraction of identity fields (`notion_id`, `title`) from
the raw frontmatter text. Losing `notion_id` silently causes duplicate
page creation on push.

## Rules

- Narrow the catch to known YAML/parse errors only. Re-throw unexpected
  exceptions (OOM, encoding, permission errors) so they surface normally.
- After stripping frontmatter, extract `notion_id` and `title` via
  simple line-by-line regex. Do not assume the full YAML structure is valid.
- Strip surrounding quotes (`"..."`, `'...'`) and trailing inline comments
  (`# ...`) from extracted values before storing them in `data`.
- Log or warn when the fallback path activates so the failure is visible.

## Bad pattern

```typescript
} catch {
  // Silently drops notion_id — creates duplicate pages on next push.
  content = stripFrontmatter(raw);
  data = {};
}
```

## Good pattern

```typescript
} catch (parseError) {
  if (!isYamlParseError(parseError)) throw parseError;
  content = stripFrontmatter(raw);
  data = extractFrontmatterIds(raw); // recovers notion_id, title
}
```
