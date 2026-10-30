import { describe, expect, it } from 'vitest';

import { formatPageFooter } from './pagination';

describe('formatPageFooter', () => {
  it('reports the position and next page when a total is known', () => {
    expect(formatPageFooter({ count: 30, page: 2, pageSize: 30, total: 61 })).toBe(
      'Page 2/3 · 31-60 of 61 · next: --page 3',
    );
  });

  it('marks the last page when a total is known', () => {
    expect(formatPageFooter({ count: 1, page: 3, pageSize: 30, total: 61 })).toBe(
      'Page 3/3 · 61-61 of 61 · no more pages',
    );
  });

  it('points to the last page when the page is past the end', () => {
    expect(formatPageFooter({ count: 0, page: 5, pageSize: 30, total: 61 })).toBe(
      'Page 5 is past the end · 61 total · last page: --page 3',
    );
  });

  it('points at the next page after a full page without a total', () => {
    expect(formatPageFooter({ count: 100, page: 1, pageSize: 100 })).toBe(
      'Page 1 · 1-100 · next: --page 2',
    );
  });

  it('ends on a short or empty page without a total', () => {
    expect(formatPageFooter({ count: 7, page: 2, pageSize: 100 })).toBe(
      'Page 2 · 101-107 · no more pages',
    );
    expect(formatPageFooter({ count: 0, page: 3, pageSize: 100 })).toBe(
      'Page 3 · 0 · no more pages',
    );
  });
});
