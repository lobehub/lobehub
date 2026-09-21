import { describe, expect, it } from 'vitest';

import { TASK_SLUG_MAX_LENGTH, taskTitleSlug } from './taskSlug';

const toGraphemes = (value: string) =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(
    (entry) => entry.segment,
  );

describe('taskTitleSlug', () => {
  it('lowercases and joins words with a single dash', () => {
    expect(taskTitleSlug('Ship the Thing')).toBe('ship-the-thing');
  });

  it('keeps CJK characters instead of transliterating them', () => {
    expect(taskTitleSlug('飞书适配器支持 POST 图文消息')).toBe('飞书适配器支持-post-图文消息');
  });

  // Regression: the character class allowed only letters and digits, so the
  // combining marks these scripts are built from were treated as separators
  // and each word came out shredded (`कार्य पूरा करें` → `क-र-य-प-र-कर`). CJK
  // needs no marks, which is why every existing case missed it.
  it('keeps combining marks so mark-bearing scripts stay readable', () => {
    expect(taskTitleSlug('कार्य पूरा करें')).toBe('कार्य-पूरा-करें');
    expect(taskTitleSlug('สวัสดี')).toBe('สวัสดี');
    expect(taskTitleSlug('مَرْحَبًا')).toBe('مَرْحَبًا');
  });

  it('collapses punctuation, symbols and repeated separators into one dash', () => {
    expect(taskTitleSlug('fix: the  bug!! (again)')).toBe('fix-the-bug-again');
    expect(taskTitleSlug('a___b')).toBe('a-b');
    expect(taskTitleSlug('ship 🚀 it')).toBe('ship-it');
  });

  it('trims leading and trailing separators', () => {
    expect(taskTitleSlug('  --hello--  ')).toBe('hello');
  });

  it('returns an empty slug for absent or symbol-only titles', () => {
    expect(taskTitleSlug()).toBe('');
    expect(taskTitleSlug(null)).toBe('');
    expect(taskTitleSlug('   ')).toBe('');
    expect(taskTitleSlug('!!! ???')).toBe('');
  });

  it('truncates long titles without leaving a dangling separator', () => {
    const slug = taskTitleSlug(`${'a'.repeat(TASK_SLUG_MAX_LENGTH)} tail`);

    expect(slug).toBe('a'.repeat(TASK_SLUG_MAX_LENGTH));
    expect(slug.endsWith('-')).toBe(false);
  });

  it('truncates by code point so an astral character is never split', () => {
    const slug = taskTitleSlug('𝒜'.repeat(TASK_SLUG_MAX_LENGTH + 10));

    expect([...slug]).toHaveLength(TASK_SLUG_MAX_LENGTH);
    expect(slug.includes('�')).toBe(false);
  });

  it('truncates by grapheme cluster so a combining mark keeps its base letter', () => {
    // `कि` is two code points (base + matra) and one cluster. Slicing by code
    // point would cut a cluster in half and strand a matra in the URL.
    const slug = taskTitleSlug('कि'.repeat(TASK_SLUG_MAX_LENGTH + 10));

    expect(toGraphemes(slug)).toHaveLength(TASK_SLUG_MAX_LENGTH);
    expect(slug).toBe('कि'.repeat(TASK_SLUG_MAX_LENGTH));
  });

  it('bounds the slug by code points, not only by grapheme count', () => {
    // One base letter plus 10k combining accents is a SINGLE grapheme, so a
    // grapheme-only cap left it whole — a ~20KB path segment past what browsers
    // and proxies accept. Titles arrive from imported and generated content,
    // so the bound has to hold for input nobody typed.
    const slug = taskTitleSlug(`a${'\u0301'.repeat(10_000)}`);

    expect([...slug].length).toBeLessThanOrEqual(4 * TASK_SLUG_MAX_LENGTH);
  });

  it('emits only characters that are legal in a path segment', () => {
    expect(taskTitleSlug('a/b?c#d e%f')).toBe('a-b-c-d-e-f');
  });
});
