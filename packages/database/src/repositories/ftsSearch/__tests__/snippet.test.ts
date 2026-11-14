import { describe, expect, it } from 'vitest';

import { buildMatchSnippet } from '../snippet';

const filler = (length: number) => '无关内容。'.repeat(Math.ceil(length / 5)).slice(0, length);

describe('buildMatchSnippet', () => {
  it('returns short content unchanged', () => {
    expect(buildMatchSnippet('住宿标准', '住宿', 300)).toBe('住宿标准');
  });

  it('returns null for empty content', () => {
    expect(buildMatchSnippet(null, '住宿', 300)).toBeNull();
    expect(buildMatchSnippet('', '住宿', 300)).toBeNull();
  });

  it('shows the matched passage when it is far beyond the document head', () => {
    const content = `${filler(2000)}普通员工住宿标准为每晚 500 元。${filler(2000)}`;

    const snippet = buildMatchSnippet(content, '住宿标准', 300)!;

    expect(snippet).toContain('每晚 500 元');
    expect(snippet.startsWith('...')).toBe(true);
    expect(snippet.endsWith('...')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(303);
  });

  it('prefers the window covering the most distinct terms', () => {
    const content = `住宿${filler(1000)}普通员工的住宿上限${filler(1000)}`;

    expect(buildMatchSnippet(content, '住宿 普通员工', 100)).toContain('普通员工的住宿上限');
  });

  it('locates a long CJK query that never appears verbatim', () => {
    const content = `${filler(2000)}差旅住宿费用的报销规定${filler(2000)}`;

    expect(buildMatchSnippet(content, '住宿费用标准', 100)).toContain('差旅住宿费用');
  });

  it('matches case-insensitively and treats query syntax literally', () => {
    const content = `${filler(1000)}The SLA (v4.1) applies.${filler(1000)}`;

    expect(buildMatchSnippet(content, 'sla (v4.1)', 100)).toContain('The SLA (v4.1)');
  });

  it('handles a matching term wider than the snippet window', () => {
    const term = 'x'.repeat(400);
    const content = `${filler(1000)}${term}`;

    const snippet = buildMatchSnippet(content, term, 300)!;

    expect(snippet).toContain('x'.repeat(290));
    expect(snippet.length).toBeLessThanOrEqual(303);
  });

  it('keeps the document head when no term is locatable', () => {
    const content = filler(1000);

    expect(buildMatchSnippet(content, 'absent', 300)).toBe(`${content.slice(0, 300)}...`);
  });

  it('does not add a trailing ellipsis at the end of the document', () => {
    const content = `${filler(1000)}结尾处的住宿标准`;

    const snippet = buildMatchSnippet(content, '住宿标准', 100)!;

    expect(snippet.endsWith('结尾处的住宿标准')).toBe(true);
  });
});
