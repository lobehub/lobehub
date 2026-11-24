import { describe, expect, it } from 'vitest';

import { buildMatchSnippet } from './snippet';

describe('buildMatchSnippet', () => {
  it('returns null without content', () => {
    expect(buildMatchSnippet(null, 'kestrel')).toBeNull();
    expect(buildMatchSnippet('   ', 'kestrel')).toBeNull();
  });

  it('keeps the opening text when the match is near the start', () => {
    expect(buildMatchSnippet('Kestrel rollout notes', 'kestrel')).toBe('Kestrel rollout notes');
  });

  it('centres a late match and marks both cut edges', () => {
    const content = `${'filler words '.repeat(40)}the kestrel rollout starts ${'tail words '.repeat(40)}`;

    const snippet = buildMatchSnippet(content, 'kestrel', 80)!;

    expect(snippet.startsWith('...')).toBe(true);
    expect(snippet.endsWith('...')).toBe(true);
    expect(snippet).toContain('the kestrel rollout');
    expect(snippet.length).toBeLessThanOrEqual(86);
  });

  it('does not cut the first word in half', () => {
    const content = `${'alpha beta gamma delta '.repeat(10)}kestrel`;

    const snippet = buildMatchSnippet(content, 'kestrel', 60)!;

    expect(snippet.replace(/^\.\.\./, '').split(' ')[0]).toMatch(/^(alpha|beta|gamma|delta)$/);
  });

  it('matches case-insensitively and picks the earliest of several terms', () => {
    const content = `${'x '.repeat(100)}Falcon appears first, then KESTREL`;

    expect(buildMatchSnippet(content, 'kestrel falcon', 40)).toContain('Falcon appears');
  });

  it('collapses whitespace from parsed documents but keeps line breaks for markdown', () => {
    expect(buildMatchSnippet('Line one  \n\n\t## kestrel   here', 'kestrel')).toBe(
      'Line one\n## kestrel here',
    );
  });

  it('matches CJK queries without word boundaries', () => {
    const content = `${'无关内容'.repeat(30)}这里讲机器学习的基础${'结尾'.repeat(30)}`;

    expect(buildMatchSnippet(content, '机器学习', 40)).toContain('机器学习');
  });

  it('falls back to the opening text when no term appears literally', () => {
    const content = `Running notes ${'more '.repeat(60)}`;

    expect(buildMatchSnippet(content, 'runs', 20)).toBe('Running notes more m...');
  });
});
