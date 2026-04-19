/**
 * Unit tests for the pure sync helper functions.
 *
 * These tests exercise normalizeItalics, appendMissingChildTags,
 * escapeTagAttribute, escapeTagText, and extractNotionErrorDetail without
 * any Notion API calls. Fast, deterministic, and safe to run anywhere.
 */

import { describe, expect, it } from 'vitest';
import {
  appendMissingChildTags,
  escapeTagAttribute,
  escapeTagText,
  extractNotionErrorDetail,
  normalizeItalics,
  stripFrontmatter,
} from '../src/index.js';

/* ------------------------------------------------------------------ */
/*  normalizeItalics                                                    */
/* ------------------------------------------------------------------ */

describe('normalizeItalics', () => {
  it('converts _text_ to *text*', () => {
    expect(normalizeItalics('Some _italic_ here')).toBe('Some *italic* here');
  });

  it('converts multi-word _italic spans_', () => {
    expect(normalizeItalics('_Add dates and results as tested_')).toBe(
      '*Add dates and results as tested*'
    );
  });

  it('handles multiple italic spans in one line', () => {
    expect(normalizeItalics('_first_ and _second_')).toBe('*first* and *second*');
  });

  it('preserves __bold__ (double-underscore)', () => {
    expect(normalizeItalics('This is __bold__ text')).toBe('This is __bold__ text');
  });

  it('preserves underscores inside inline code', () => {
    expect(normalizeItalics('Use `some_var_name` here')).toBe('Use `some_var_name` here');
  });

  it('preserves underscores inside fenced code blocks', () => {
    const input = '```\nconst _foo_ = bar;\n```';
    expect(normalizeItalics(input)).toBe(input);
  });

  it('preserves underscores inside link targets', () => {
    const input = '[docs](https://example.com/_docs_/v1)';
    expect(normalizeItalics(input)).toBe(input);
  });

  it('does not rewrite mid-word underscores like snake_case', () => {
    // "snake_case_name" has underscores bounded by letters, so no match.
    expect(normalizeItalics('The snake_case_name variable')).toBe('The snake_case_name variable');
  });

  it('handles underscore italic at start of string', () => {
    expect(normalizeItalics('_start_ of line')).toBe('*start* of line');
  });

  it('handles underscore italic at end of string', () => {
    expect(normalizeItalics('end of _line_')).toBe('end of *line*');
  });

  it('returns empty string unchanged', () => {
    expect(normalizeItalics('')).toBe('');
  });

  it('leaves already-asterisk italics alone', () => {
    expect(normalizeItalics('Already *italic* text')).toBe('Already *italic* text');
  });

  it('handles fenced code with language annotation', () => {
    const input = '```python\ndef _private():\n    pass\n```';
    expect(normalizeItalics(input)).toBe(input);
  });

  it('converts italics adjacent to punctuation', () => {
    expect(normalizeItalics('(_note_)')).toBe('(*note*)');
  });
});

/* ------------------------------------------------------------------ */
/*  escapeTagAttribute                                                  */
/* ------------------------------------------------------------------ */

describe('escapeTagAttribute', () => {
  it('escapes ampersand', () => {
    expect(escapeTagAttribute('a&b')).toBe('a&amp;b');
  });

  it('escapes angle brackets', () => {
    expect(escapeTagAttribute('<tag>')).toBe('&lt;tag&gt;');
  });

  it('escapes double quotes', () => {
    expect(escapeTagAttribute('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('handles multiple special characters', () => {
    expect(escapeTagAttribute('a&b<c>"d')).toBe('a&amp;b&lt;c&gt;&quot;d');
  });

  it('returns plain strings unchanged', () => {
    expect(escapeTagAttribute('https://www.notion.so/abc123')).toBe('https://www.notion.so/abc123');
  });
});

/* ------------------------------------------------------------------ */
/*  escapeTagText                                                       */
/* ------------------------------------------------------------------ */

describe('escapeTagText', () => {
  it('escapes ampersand', () => {
    expect(escapeTagText('R&D')).toBe('R&amp;D');
  });

  it('escapes angle brackets', () => {
    expect(escapeTagText('value < 10 > 5')).toBe('value &lt; 10 &gt; 5');
  });

  it('does NOT escape double quotes (only attributes need that)', () => {
    expect(escapeTagText('say "hello"')).toBe('say "hello"');
  });

  it('returns plain titles unchanged', () => {
    expect(escapeTagText('My Page Title')).toBe('My Page Title');
  });
});

/* ------------------------------------------------------------------ */
/*  appendMissingChildTags                                              */
/* ------------------------------------------------------------------ */

describe('appendMissingChildTags', () => {
  const makeChild = (
    overrides: Partial<{
      id: string;
      title: string;
      type: 'child_page' | 'child_database';
      url: string | null;
    }> = {}
  ) => ({
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    title: 'Child Title',
    type: 'child_page' as const,
    url: 'https://www.notion.so/aaaaaaaabbbbccccddddeeeeeeeeeeee',
    ...overrides,
  });

  it('appends a <page> tag when child is missing from markdown', () => {
    const result = appendMissingChildTags('# Hello\n', [makeChild()]);
    expect(result).toContain('<page url=');
    expect(result).toContain('Child Title');
    expect(result).toContain('aaaaaaaabbbbccccddddeeeeeeeeeeee');
  });

  it('skips children already referenced via <page> tag', () => {
    const md =
      '# Hello\n\n<page url="https://www.notion.so/aaaaaaaabbbbccccddddeeeeeeeeeeee">Child</page>\n';
    const result = appendMissingChildTags(md, [makeChild()]);
    // Should not duplicate the tag.
    expect(result).toBe(md);
  });

  it('skips children referenced via <unknown> tag with their ID', () => {
    const md =
      '# Hello\n\n<unknown url="https://www.notion.so/aaaaaaaabbbbccccddddeeeeeeeeeeee">?</unknown>\n';
    const result = appendMissingChildTags(md, [makeChild()]);
    expect(result).toBe(md);
  });

  it('does NOT false-positive on ID appearing in prose', () => {
    // ID appears in plain text, not in a tag — child should still be appended.
    const md = '# Hello\n\nReference aaaaaaaabbbbccccddddeeeeeeeeeeee in text.\n';
    const result = appendMissingChildTags(md, [makeChild()]);
    expect(result).toContain('<page url=');
  });

  it('appends <database> tags for child_database type', () => {
    const child = makeChild({ type: 'child_database', url: null });
    const result = appendMissingChildTags('# Hello\n', [child]);
    expect(result).toContain('<database url=');
    expect(result).toContain('</database>');
  });

  it('returns markdown unchanged when children array is empty', () => {
    const md = '# Hello\n';
    expect(appendMissingChildTags(md, [])).toBe(md);
  });

  it('escapes special characters in child titles', () => {
    const child = makeChild({ title: 'R&D <Notes>' });
    const result = appendMissingChildTags('# Hello\n', [child]);
    expect(result).toContain('R&amp;D &lt;Notes&gt;');
    expect(result).not.toContain('R&D <Notes>');
  });

  it('escapes special characters in URLs', () => {
    const child = makeChild({ url: 'https://example.com/a&b"c' });
    const result = appendMissingChildTags('# Hello\n', [child]);
    expect(result).toContain('a&amp;b&quot;c');
  });

  it('handles multiple children, some referenced and some not', () => {
    const referenced = makeChild({ id: '11111111-2222-3333-4444-555555555555' });
    const missing = makeChild({
      id: 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff',
      title: 'New Page',
      url: 'https://www.notion.so/aaaaaaaabbbbccccddddffffffffffff',
    });
    const md =
      '# Hello\n\n<page url="https://www.notion.so/11111111222233334444555555555555">Old</page>\n';
    const result = appendMissingChildTags(md, [referenced, missing]);
    // Old one should not be duplicated.
    const pageTagCount = (result.match(/<page /g) || []).length;
    expect(pageTagCount).toBe(2); // original + newly appended
    expect(result).toContain('New Page');
  });
});

/* ------------------------------------------------------------------ */
/*  extractNotionErrorDetail                                            */
/* ------------------------------------------------------------------ */

describe('extractNotionErrorDetail', () => {
  it('extracts message from a standard Error', () => {
    const error = new Error('Something went wrong');
    expect(extractNotionErrorDetail(error)).toContain('Something went wrong');
  });

  it('extracts message and code from Notion-style error objects', () => {
    const error = { message: 'Validation failed', code: 'validation_error' };
    const detail = extractNotionErrorDetail(error);
    expect(detail).toContain('Validation failed');
    expect(detail).toContain('[validation_error]');
  });

  it('extracts nested body.message', () => {
    const error = {
      message: 'outer',
      body: { message: 'This operation would delete 3 child page(s)' },
    };
    const detail = extractNotionErrorDetail(error);
    expect(detail).toContain('delete 3 child page(s)');
  });

  it('extracts string body', () => {
    const error = { message: 'outer', body: '{"detail":"raw json"}' };
    const detail = extractNotionErrorDetail(error);
    expect(detail).toContain('raw json');
  });

  it('handles non-object errors (string)', () => {
    expect(extractNotionErrorDetail('plain string error')).toBe('plain string error');
  });

  it('handles non-object errors (number)', () => {
    expect(extractNotionErrorDetail(42)).toBe('42');
  });

  it('handles null', () => {
    expect(extractNotionErrorDetail(null)).toBe('null');
  });

  it('handles error with only code, no message', () => {
    const error = { code: 'object_not_found' };
    expect(extractNotionErrorDetail(error)).toContain('[object_not_found]');
  });
});

/* ------------------------------------------------------------------ */
/*  stripFrontmatter                                                    */
/* ------------------------------------------------------------------ */

describe('stripFrontmatter', () => {
  it('strips a valid frontmatter block', () => {
    const input = '---\ntitle: Hello\n---\n# Body';
    expect(stripFrontmatter(input)).toBe('# Body');
  });

  it('strips frontmatter with complex YAML that would break the parser', () => {
    const input =
      '---\nname: tribunal\ndescription: Triggers: "tribunal", "panel critique".\n---\n# Content';
    expect(stripFrontmatter(input)).toBe('# Content');
  });

  it('returns content unchanged when no frontmatter is present', () => {
    const input = '# Just markdown\n\nNo frontmatter here.';
    expect(stripFrontmatter(input)).toBe(input);
  });

  it('handles empty frontmatter block', () => {
    const input = '---\n---\n# Body';
    expect(stripFrontmatter(input)).toBe('# Body');
  });

  it('handles Windows-style line endings', () => {
    const input = '---\r\ntitle: Hello\r\n---\r\n# Body';
    expect(stripFrontmatter(input)).toBe('# Body');
  });

  it('only strips the first frontmatter block', () => {
    const input = '---\ntitle: Hello\n---\nMiddle\n---\nmore: yaml\n---\nEnd';
    const result = stripFrontmatter(input);
    expect(result).toBe('Middle\n---\nmore: yaml\n---\nEnd');
  });

  it('handles frontmatter with no trailing content', () => {
    const input = '---\ntitle: Hello\n---\n';
    expect(stripFrontmatter(input)).toBe('');
  });
});
