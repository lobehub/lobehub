import type { InboundWebhookItem } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AUTOMATIONS_SWR_KEY, useAutomationList } from './useAutomationList';

const mocks = vi.hoisted(() => ({
  key: undefined as unknown,
  list: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (key: unknown, fetcher: () => unknown) => {
    mocks.key = key;
    void fetcher();
    return { data: [], error: undefined, isLoading: false, mutate: mocks.mutate };
  },
}));

vi.mock('@/services/inboundWebhook', () => ({
  inboundWebhookService: { list: mocks.list },
}));

const ROWS = [
  { id: 'a', status: 'active' },
  { id: 'b', status: 'error' },
] as InboundWebhookItem[];

/** Applies the updater the hook handed to SWR's `mutate`, as SWR would. */
const applyLastMutate = (rows: InboundWebhookItem[]) => {
  const [updater, options] = mocks.mutate.mock.calls.at(-1)!;
  return { options, rows: (updater as (rows: InboundWebhookItem[]) => InboundWebhookItem[])(rows) };
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('useAutomationList', () => {
  it('loads the list under its own key (the SWR helper adds the workspace)', () => {
    renderHook(() => useAutomationList());

    expect(mocks.key).toEqual([AUTOMATIONS_SWR_KEY]);
    expect(mocks.list).toHaveBeenCalled();
  });

  it('swaps a checked row in place without refetching the list', () => {
    const { result } = renderHook(() => useAutomationList());
    const next = { id: 'b', status: 'active' } as InboundWebhookItem;

    void result.current.replaceRow(next);
    const { options, rows } = applyLastMutate(ROWS);

    expect(rows).toEqual([ROWS[0], next]);
    expect(options).toEqual({ revalidate: false });
  });

  it('drops a removed row without refetching the list', () => {
    const { result } = renderHook(() => useAutomationList());

    void result.current.removeRow('a');
    const { options, rows } = applyLastMutate(ROWS);

    expect(rows).toEqual([ROWS[1]]);
    expect(options).toEqual({ revalidate: false });
  });

  it('retries by refetching', () => {
    const { result } = renderHook(() => useAutomationList());

    void result.current.reload();

    expect(mocks.mutate).toHaveBeenCalledWith();
  });
});
