import { describe, expect, it } from 'vitest';

import {
  appendTextWindowNotice,
  countLines,
  formatTextWindowAttributes,
  formatTextWindowNotice,
  sliceHead,
  sliceTextWindow,
} from './index';

const continueFrom = (line: number) => `call read with offset=${line}`;

describe('sliceHead', () => {
  it('does not split a surrogate pair', () => {
    const emoji = '🐛';
    expect(sliceHead(`ab${emoji}`, 3)).toBe('ab');
    expect(sliceHead(`ab${emoji}`, 4)).toBe(`ab${emoji}`);
  });
});

describe('countLines', () => {
  it('counts newline-separated lines', () => {
    expect(countLines('')).toBe(1);
    expect(countLines('a\nb\n')).toBe(3);
  });
});

describe('sliceTextWindow', () => {
  it('returns the whole text when it fits', () => {
    expect(sliceTextWindow('a\nb')).toEqual({
      content: 'a\nb',
      endLine: 2,
      startLine: 1,
      totalChars: 3,
      totalLines: 2,
      truncated: false,
    });
  });

  it('stops at whole lines when the character budget is hit', () => {
    const window = sliceTextWindow('aaaa\nbbbb\ncccc', { maxChars: 10 });

    expect(window.content).toBe('aaaa\nbbbb');
    expect(window.endLine).toBe(2);
    expect(window.truncated).toBe(true);
  });

  it('fills the remaining budget with the head of a line that can never fit', () => {
    const window = sliceTextWindow(`short\n${'x'.repeat(100)}\nnext`, { maxChars: 20 });

    expect(window.content).toBe(`short\n${'x'.repeat(14)}`);
    expect(window.endLine).toBe(2);
    expect(window.cutLine).toEqual({ keptChars: 14, line: 2, totalChars: 100 });
  });

  it('leaves a line that fits a later window for that window', () => {
    const window = sliceTextWindow(`short\n${'x'.repeat(18)}`, { maxChars: 20 });

    expect(window.content).toBe('short');
    expect(window.cutLine).toBeUndefined();
  });
});

describe('formatTextWindowNotice', () => {
  it('is empty for a complete window', () => {
    expect(formatTextWindowNotice(sliceTextWindow('a\nb'), { continueFrom })).toBe('');
  });

  it('reports the range, total size and the next call', () => {
    const window = sliceTextWindow('a\nb\nc', { maxLines: 2 });

    expect(formatTextWindowNotice(window, { continueFrom })).toBe(
      '[Showing lines 1-2 of 3 lines, 5 characters. To continue, call read with offset=3.]',
    );
  });

  it('says what was left out when the text cannot be paged', () => {
    const window = sliceTextWindow('a\nb\nc', { maxLines: 1 });

    expect(formatTextWindowNotice(window)).toBe(
      '[Showing lines 1-1 of 3 lines, 5 characters. Lines 2-3 were left out.]',
    );
  });

  it('explains a cut line and continues after it', () => {
    const window = sliceTextWindow(`${'x'.repeat(30)}\nb`, { maxChars: 10 });

    expect(formatTextWindowNotice(window, { continueFrom })).toBe(
      '[Showing lines 1-1 of 2 lines, 32 characters. Line 1 is 30 characters long and was cut at 10; the rest of that line cannot be paged. To continue with the next line, call read with offset=2.]',
    );
  });

  it('reports an offset past the end', () => {
    const window = sliceTextWindow('a\nb', { offset: 5 });

    expect(formatTextWindowNotice(window, { continueFrom })).toContain(
      'Line 5 is past the end of this text (2 lines, 3 characters)',
    );
  });

  it('says the stored text is incomplete when the original was longer', () => {
    const window = sliceTextWindow('a\nb');
    const notice = formatTextWindowNotice(window, { continueFrom, originalChars: 9000 });

    expect(notice).toContain('only the first 3 of the original 9000 characters were kept');
    expect(notice).toContain('ending at line 2');
    expect(formatTextWindowNotice(window, { originalChars: 3 })).toBe('');
  });
});

describe('formatTextWindowAttributes', () => {
  it('describes the window and the original size', () => {
    const window = sliceTextWindow('a\nb\nc', { maxLines: 2 });

    expect(formatTextWindowAttributes(window)).toBe(
      ' lines="1-2" total_lines="3" total_chars="5" truncated="true"',
    );
    expect(formatTextWindowAttributes(sliceTextWindow('a'), { originalChars: 50 })).toBe(
      ' lines="1-1" total_lines="1" total_chars="1" truncated="true" original_chars="50"',
    );
  });
});

describe('appendTextWindowNotice', () => {
  it('returns content alone when nothing was left out', () => {
    expect(appendTextWindowNotice(sliceTextWindow('abc'))).toBe('abc');
  });
});
