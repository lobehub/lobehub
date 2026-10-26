import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  MAX_DEEP_LINK_BACKFILL_PAGES,
  useDeepLinkHistoryBackfill,
} from './useDeepLinkHistoryBackfill';

const setup = (initial: {
  deepLinkKey?: string;
  loadedCount?: number;
  ready?: boolean;
  resolved?: boolean;
}) => {
  const loadEarlierMessages = vi.fn().mockResolvedValue(undefined);
  const props = { loadedCount: 10, ready: true, resolved: false, ...initial };
  const hook = renderHook(
    (current: typeof props) => useDeepLinkHistoryBackfill({ ...current, loadEarlierMessages }),
    { initialProps: props },
  );

  return { ...hook, loadEarlierMessages, props };
};

describe('useDeepLinkHistoryBackfill', () => {
  it('loads one older page per settled page until the target is loaded', () => {
    const { loadEarlierMessages, props, rerender } = setup({ deepLinkKey: 'k1' });
    expect(loadEarlierMessages).toHaveBeenCalledTimes(1);

    rerender({ ...props, loadedCount: 20 });
    expect(loadEarlierMessages).toHaveBeenCalledTimes(2);

    rerender({ ...props, loadedCount: 30, resolved: true });
    expect(loadEarlierMessages).toHaveBeenCalledTimes(2);
  });

  it('stops once a page adds no rows', () => {
    const { loadEarlierMessages, props, rerender } = setup({ deepLinkKey: 'k1' });

    rerender({ ...props, ready: false });
    rerender({ ...props });

    expect(loadEarlierMessages).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a pending deep link or before the first page settles', () => {
    expect(setup({}).loadEarlierMessages).not.toHaveBeenCalled();
    expect(setup({ deepLinkKey: 'k1', ready: false }).loadEarlierMessages).not.toHaveBeenCalled();
    expect(setup({ deepLinkKey: 'k1', resolved: true }).loadEarlierMessages).not.toHaveBeenCalled();
  });

  it('starts over for a new navigation and caps the pages per deep link', () => {
    const { loadEarlierMessages, props, rerender } = setup({ deepLinkKey: 'k1' });
    for (let page = 1; page <= MAX_DEEP_LINK_BACKFILL_PAGES + 5; page += 1)
      rerender({ ...props, loadedCount: 10 + page });
    expect(loadEarlierMessages).toHaveBeenCalledTimes(MAX_DEEP_LINK_BACKFILL_PAGES);

    rerender({ ...props, deepLinkKey: 'k2', loadedCount: 999 });
    expect(loadEarlierMessages).toHaveBeenCalledTimes(MAX_DEEP_LINK_BACKFILL_PAGES + 1);
  });
});
