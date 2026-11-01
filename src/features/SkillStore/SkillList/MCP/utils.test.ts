import { describe, expect, it } from 'vitest';

import { canAutoLoadMore, resolveMCPListFooter } from './utils';

const list = (overrides: Partial<Parameters<typeof resolveMCPListFooter>[0]> = {}) => ({
  hasMore: true,
  isLoadingMore: false,
  ...overrides,
});

describe('resolveMCPListFooter', () => {
  it('surfaces a failed page instead of falling through to the idle spacer', () => {
    expect(resolveMCPListFooter(list({ loadMoreError: new Error('offline') }))).toBe('error');
  });

  it('shows the spinner while a page is in flight', () => {
    expect(resolveMCPListFooter(list({ isLoadingMore: true }))).toBe('loading');
  });

  it('marks the end of the list', () => {
    expect(resolveMCPListFooter(list({ hasMore: false }))).toBe('exhausted');
  });

  it('keeps a spacer while more pages are available', () => {
    expect(resolveMCPListFooter(list())).toBe('spacer');
  });
});

describe('canAutoLoadMore', () => {
  it('stands down while the last page failed', () => {
    expect(canAutoLoadMore(list({ loadMoreError: new Error('offline') }))).toBe(false);
  });

  it('pages when nothing is failing and more rows remain', () => {
    expect(canAutoLoadMore(list())).toBe(true);
    expect(canAutoLoadMore(list({ hasMore: false }))).toBe(false);
  });
});
