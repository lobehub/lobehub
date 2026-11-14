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
import {
  type PendingTransferRequest,
  resourceTransferRequestService,
} from '@/services/resourceTransferRequest';
import { useHomeStore } from '@/store/home';
import { initialHomeNotificationState } from '@/store/home/slices/notification/initialState';
import {
  PENDING_TRANSFER_REQUESTS_KEY,
  pendingTransferRequestsResource,
} from '@/store/home/slices/notification/projection';

import { usePendingTransfers } from './usePendingTransfers';

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

const transfer = (id: string) =>
  ({ createdAt: new Date(0), id, recipientId: 'me' }) as PendingTransferRequest;

let scope = '';

beforeEach(() => {
  scope = `transfers-${randomUUID()}:ws-1`;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  act(() => useHomeStore.setState({ ...initialHomeNotificationState }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePendingTransfers', () => {
  it('keeps restored cards, surfaces a failed read and confirms them on retry', async () => {
    await pendingTransferRequestsResource.storage!.set(
      { queryKey: PENDING_TRANSFER_REQUESTS_KEY, scope },
      { data: [transfer('t1')], updatedAt: 1 },
    );
    const listMine = vi
      .spyOn(resourceTransferRequestService, 'listMine')
      .mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => usePendingTransfers(true), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.requests?.map((r) => r.id)).toEqual(['t1']);
    expect(result.current.isConfirmed).toBe(false);

    listMine.mockResolvedValue([transfer('t1')]);
    await act(() => result.current.retry());

    await waitFor(() => expect(result.current.isConfirmed).toBe(true));
    expect(result.current.error).toBeFalsy();
  });
});
