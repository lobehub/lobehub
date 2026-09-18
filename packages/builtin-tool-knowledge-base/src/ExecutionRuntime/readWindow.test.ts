import { describe, expect, it } from 'vitest';

import {
  DEFAULT_READ_KNOWLEDGE_LINE_LIMIT,
  MAX_READ_KNOWLEDGE_CHARS_PER_FILE,
  MAX_READ_KNOWLEDGE_LINE_LIMIT,
  sliceReadWindow,
} from './readWindow';

const buildLines = (count: number, width = 5) =>
  Array.from({ length: count }, (_, i) => `${i + 1}`.padStart(width, 'L')).join('\n');

describe('sliceReadWindow', () => {
  it('returns the whole file when it fits in the default window', () => {
    const content = 'a\nb\nc';
    const window = sliceReadWindow(content);

    expect(window).toEqual({
      content,
      endLine: 3,
      startLine: 1,
      totalCharCount: 5,
      totalLineCount: 3,
      truncated: false,
    });
  });

  it('caps at the default line limit and flags truncation', () => {
    const content = buildLines(DEFAULT_READ_KNOWLEDGE_LINE_LIMIT + 10);
    const window = sliceReadWindow(content);

    expect(window.startLine).toBe(1);
    expect(window.endLine).toBe(DEFAULT_READ_KNOWLEDGE_LINE_LIMIT);
    expect(window.truncated).toBe(true);
    expect(window.content.split('\n')).toHaveLength(DEFAULT_READ_KNOWLEDGE_LINE_LIMIT);
  });

  it('pages from a 1-based offset with an explicit limit', () => {
    const content = buildLines(10);
    const window = sliceReadWindow(content, { limit: 3, offset: 4 });

    expect(window.content).toBe('LLLL4\nLLLL5\nLLLL6');
    expect(window.startLine).toBe(4);
    expect(window.endLine).toBe(6);
    expect(window.truncated).toBe(true);

    const tail = sliceReadWindow(content, { limit: 3, offset: 10 });
    expect(tail.content).toBe('LLL10');
    expect(tail.endLine).toBe(10);
    expect(tail.truncated).toBe(false);
  });

  it('returns an empty window when offset is past the end', () => {
    const window = sliceReadWindow('a\nb', { offset: 5 });

    expect(window.content).toBe('');
    expect(window.startLine).toBe(5);
    expect(window.endLine).toBe(0);
    expect(window.truncated).toBe(false);
    expect(window.totalLineCount).toBe(2);
  });

  it('stops before exceeding the per-file character cap', () => {
    // 3 lines of 4,000 chars: the cap of 10,000 admits two of them.
    const content = ['x'.repeat(4000), 'y'.repeat(4000), 'z'.repeat(4000)].join('\n');
    const window = sliceReadWindow(content);

    expect(window.content.length).toBeLessThanOrEqual(MAX_READ_KNOWLEDGE_CHARS_PER_FILE);
    expect(window.endLine).toBe(2);
    expect(window.truncated).toBe(true);

    const rest = sliceReadWindow(content, { offset: window.endLine + 1 });
    expect(rest.content).toBe('z'.repeat(4000));
    expect(rest.truncated).toBe(false);
  });

  it('cuts a single line that alone exceeds the char cap and still advances', () => {
    const content = ['a'.repeat(30_000), 'b'].join('\n');
    const window = sliceReadWindow(content);

    expect(window.content).toBe('a'.repeat(MAX_READ_KNOWLEDGE_CHARS_PER_FILE));
    expect(window.content.length).toBe(MAX_READ_KNOWLEDGE_CHARS_PER_FILE);
    expect(window.endLine).toBe(1);
    expect(window.truncated).toBe(true);
    expect(window.cutLine).toEqual({
      keptChars: MAX_READ_KNOWLEDGE_CHARS_PER_FILE,
      line: 1,
      totalChars: 30_000,
    });

    const rest = sliceReadWindow(content, { offset: window.endLine + 1 });
    expect(rest.content).toBe('b');
    expect(rest.cutLine).toBeUndefined();
    expect(rest.truncated).toBe(false);
  });

  it('flags a cut even when the oversized line is the last line', () => {
    const window = sliceReadWindow('x'.repeat(20_000));

    expect(window.content.length).toBe(MAX_READ_KNOWLEDGE_CHARS_PER_FILE);
    expect(window.truncated).toBe(true);
    expect(window.cutLine?.totalChars).toBe(20_000);
  });

  it('coerces numeric strings so a string offset does not restart from line 1', () => {
    const content = buildLines(10);
    const window = sliceReadWindow(content, { limit: '2', offset: '4' });

    expect(window.startLine).toBe(4);
    expect(window.endLine).toBe(5);
    expect(sliceReadWindow(content, { offset: 'abc' }).startLine).toBe(1);
  });

  it('clamps out-of-range arguments instead of throwing', () => {
    const content = buildLines(5);

    expect(sliceReadWindow(content, { limit: 0, offset: 0 }).content).toBe('LLLL1');
    expect(sliceReadWindow(content, { limit: Number.NaN, offset: -3 }).endLine).toBe(5);
    expect(
      sliceReadWindow(buildLines(MAX_READ_KNOWLEDGE_LINE_LIMIT + 5), {
        limit: 999_999,
        maxChars: Number.MAX_SAFE_INTEGER,
      }).endLine,
    ).toBe(MAX_READ_KNOWLEDGE_LINE_LIMIT);
  });
});
