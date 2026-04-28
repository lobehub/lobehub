import { describe, expect, it } from 'vitest';

import { SAFE_BM25_QUERY_OPTIONS, sanitizeBm25Query } from './bm25';

describe('sanitizeBm25Query', () => {
  it('should join multiple words with AND', () => {
    expect(sanitizeBm25Query('hello world')).toBe('hello AND world');
  });

  it('should return single word as-is', () => {
    expect(sanitizeBm25Query('hello')).toBe('hello');
  });

  it('should escape tantivy special characters', () => {
    expect(sanitizeBm25Query('hello+world')).toBe('hello\\+world');
    expect(sanitizeBm25Query('a-b')).toBe('a AND b');
    expect(sanitizeBm25Query('a&b|c')).toBe('a\\&b\\|c');
    expect(sanitizeBm25Query('a &b| c')).toBe('a AND \\&b\\| AND c');
    expect(sanitizeBm25Query('test!')).toBe('test\\!');
    expect(sanitizeBm25Query('(group)')).toBe('\\(group\\)');
    expect(sanitizeBm25Query('{curly}')).toBe('\\{curly\\}');
    expect(sanitizeBm25Query('[bracket]')).toBe('\\[bracket\\]');
    expect(sanitizeBm25Query('a^b')).toBe('a\\^b');
    expect(sanitizeBm25Query('"quoted"')).toBe('\\"quoted\\"');
    expect(sanitizeBm25Query('~fuzzy')).toBe('\\~fuzzy');
    expect(sanitizeBm25Query('wild*card')).toBe('wild\\*card');
    expect(sanitizeBm25Query('single?char')).toBe('single\\?char');
    expect(sanitizeBm25Query('field:value')).toBe('field\\:value');
    expect(sanitizeBm25Query('back\\slash')).toBe('back\\\\slash');
    expect(sanitizeBm25Query('a/b')).toBe('a\\/b');
  });

  it('should escape multiple special characters and join with AND', () => {
    expect(sanitizeBm25Query('(a+b) & c!')).toBe('\\(a\\+b\\) AND \\& AND c\\!');
    expect(sanitizeBm25Query('react-component')).toBe('react AND component');
    expect(sanitizeBm25Query('<https://lobehub.com/skills/openclaw>')).toBe(
      '\\<https\\:\\/\\/lobehub.com\\/skills\\/openclaw\\>',
    );
  });

  it('should trim whitespace', () => {
    expect(sanitizeBm25Query('  hello  ')).toBe('hello');
    expect(sanitizeBm25Query('  hello world  ')).toBe('hello AND world');
  });

  it('should throw on empty string', () => {
    expect(() => sanitizeBm25Query('')).toThrow('Query is empty after sanitization');
  });

  it('should throw on whitespace-only string', () => {
    expect(() => sanitizeBm25Query('   ')).toThrow('Query is empty after sanitization');
  });

  it('should handle CJK characters', () => {
    expect(sanitizeBm25Query('你好世界')).toBe('你好世界');
    expect(sanitizeBm25Query('こんにちは')).toBe('こんにちは');
  });

  // NOTICE:
  // These safeguards document the production failure mode where lexical search
  // received extremely long, tool-injected text and generated parser-hostile
  // BM25 query expressions.
  it('should keep boolean-like tokens by default', () => {
    expect(sanitizeBm25Query('alpha AND beta')).toBe('alpha AND AND AND beta');
  });

  it('should drop boolean operator tokens from user input', () => {
    expect(sanitizeBm25Query('alpha AND beta or NOT gamma', SAFE_BM25_QUERY_OPTIONS)).toBe(
      'alpha AND beta AND gamma',
    );
  });

  it('should cap the number of terms to avoid pathological long queries', () => {
    const longQuery = Array.from({ length: 80 }, (_, index) => `term${index + 1}`).join(' ');
    const result = sanitizeBm25Query(longQuery, SAFE_BM25_QUERY_OPTIONS);

    expect(result.split(' AND ')).toHaveLength(48);
  });

  // NOTICE:
  // Public util behavior is configurable by design; these tests protect the
  // options contract for call sites with different needs.
  it('should allow overriding safe behavior when configured', () => {
    expect(sanitizeBm25Query('alpha AND beta', { ...SAFE_BM25_QUERY_OPTIONS, maxTerms: 2 })).toBe(
      'alpha AND beta',
    );
  });

  it('should allow overriding max terms', () => {
    expect(sanitizeBm25Query('a b c d', { maxTerms: 2 })).toBe('a AND b');
  });

  it('should sanitize long tool-result-like payloads safely', () => {
    const payload = `
      TOOL: <searchResults>
      <item title="No. 12 Gonzaga carves up Maryland defense in 100-61 rout"
      url="https://gozags.com/news/2025/11/25/mens-basketball-no-12-gonzaga-carves-up-maryland.aspx" />
      <item title="Men's Basketball Falls in Tight Matchup Against Brown"
      url="https://goblackbears.com/news/2025/11/23/mens-basketball-falls-in-tight-matchup-against-brown.aspx" />
      </searchResults>
      ASSISTANT: Let me search for "lost by 30 points" "November 2023" "college basketball"
      AND OR NOT AND OR NOT AND OR NOT
    `
      .repeat(30)
      .trim();

    const result = sanitizeBm25Query(payload, SAFE_BM25_QUERY_OPTIONS);
    const terms = result.split(' AND ');

    expect(terms).toHaveLength(48);
    expect(terms).not.toContain('AND');
    expect(terms).not.toContain('OR');
    expect(terms).not.toContain('NOT');
  });
});
