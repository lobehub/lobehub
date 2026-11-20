/**
 * @vitest-environment happy-dom
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { notificationService } from '@/services/notification';
import { useHomeStore } from '@/store/home';
import { initialHomeNotificationState } from '@/store/home/slices/notification/initialState';
import {
  INBOX_NAVIGATION_COUNTS_KEY,
  inboxNavigationCountsResource,
} from '@/store/home/slices/notification/projection';

import { useNavigationCounts } from './useNavigationCounts';

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map(), shouldRetryOnError: false } },
    createElement(MutateBridge),
    children,
  );

const counts = [{ category: 'agent', readCount: 1, totalCount: 3, unreadCount: 2 }];

let scope = '';

beforeEach(() => {
  scope = `counts-${randomUUID()}:personal`;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  act(() => useHomeStore.setState({ ...initialHomeNotificationState }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useNavigationCounts', () => {
  it('keeps cached counts and reports a failed refresh for Retry and the action guards', async () => {
    await inboxNavigationCountsResource.storage!.set(
      { queryKey: INBOX_NAVIGATION_COUNTS_KEY, scope },
      { data: counts, updatedAt: 1 },
    );
    const getCounts = vi
      .spyOn(notificationService, 'getNavigationCounts')
      .mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => useNavigationCounts(), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.counts?.[0].unreadCount).toBe(2);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isConfirmed).toBe(false);

    getCounts.mockResolvedValue(counts);
    await act(() => result.current.retry());

    await waitFor(() => expect(result.current.isConfirmed).toBe(true));
    expect(result.current.error).toBeFalsy();
  });
});
