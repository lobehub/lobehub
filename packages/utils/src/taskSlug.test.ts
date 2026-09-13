import { describe, expect, it } from 'vitest';

import { TASK_SLUG_MAX_LENGTH, taskTitleSlug } from './taskSlug';

describe('taskTitleSlug', () => {
  it('lowercases and joins words with a single dash', () => {
    expect(taskTitleSlug('Ship the Thing')).toBe('ship-the-thing');
  });

  it('keeps CJK characters instead of transliterating them', () => {
    expect(taskTitleSlug('飞书适配器支持 POST 图文消息')).toBe('飞书适配器支持-post-图文消息');
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

  it('emits only characters that are legal in a path segment', () => {
    expect(taskTitleSlug('a/b?c#d e%f')).toBe('a-b-c-d-e-f');
  });
});
