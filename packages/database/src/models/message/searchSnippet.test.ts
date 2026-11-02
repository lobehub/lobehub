import { describe, expect, it } from 'vitest';

import { buildMessageSearchSnippet } from './searchSnippet';

describe('buildMessageSearchSnippet', () => {
  it('centers the excerpt on the first case-insensitive match and counts every match', () => {
    const content = `${'a'.repeat(100)} Deploy the build, then deploy again ${'b'.repeat(100)}`;

    const result = buildMessageSearchSnippet(content, 'deploy', 10);

    expect(result.matchCount).toBe(2);
    expect(result.snippet).toBe('…aaaaaaaaa Deploy the build…');
  });

  it('collapses whitespace so a multi-line message reads as one line', () => {
    expect(buildMessageSearchSnippet('line one\n\n  line   two', 'two').snippet).toBe(
      'line one line two',
    );
  });

  it('matches a keyword that spans collapsed whitespace', () => {
    expect(buildMessageSearchSnippet('hello\n   world', 'hello  world').matchCount).toBe(1);
  });

  it('falls back to the head of the text when JavaScript cannot find the match', () => {
    const result = buildMessageSearchSnippet('x'.repeat(300), 'missing', 10);

    expect(result.matchCount).toBe(0);
    expect(result.snippet).toBe(`${'x'.repeat(20)}…`);
  });
});
