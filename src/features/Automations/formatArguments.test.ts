import { describe, expect, it } from 'vitest';

import { formatArgumentEntries, summarizeArguments } from './formatArguments';

describe('formatArgumentEntries', () => {
  it('keeps the order the agent wrote and renders each value as text', () => {
    expect(
      formatArgumentEntries({
        branch: 'main',
        draft: false,
        filter: { state: 'open' },
        labels: ['bug', 'p1'],
        number: 7,
        owner: null,
      }),
    ).toEqual([
      { key: 'branch', value: 'main' },
      { key: 'draft', value: 'false' },
      { key: 'filter', value: '{"state":"open"}' },
      { key: 'labels', value: 'bug, p1' },
      { key: 'number', value: '7' },
      { key: 'owner', value: '--' },
    ]);
  });

  it('is empty for missing arguments', () => {
    expect(formatArgumentEntries(undefined)).toEqual([]);
    expect(formatArgumentEntries(null)).toEqual([]);
  });
});

describe('summarizeArguments', () => {
  it('is undefined when there is no filter', () => {
    expect(summarizeArguments({})).toBeUndefined();
  });

  it('shows the first pairs and counts the rest', () => {
    expect(summarizeArguments({ a: 1, b: 'two', c: 3 })).toEqual({
      more: 1,
      text: 'a: 1 · b: two',
    });
    expect(summarizeArguments({ repo: 'o/r' })).toEqual({ more: 0, text: 'repo: o/r' });
  });

  it('clips a long value', () => {
    const summary = summarizeArguments({ q: 'x'.repeat(100) });

    expect(summary?.text).toBe(`q: ${'x'.repeat(80)}…`);
  });
});
