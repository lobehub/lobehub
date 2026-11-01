/**
 * @vitest-environment happy-dom
 *
 * Projected tool payloads are a replica keyed by message id: after a reload the
 * card paints the persisted body on the first frame and the read confirms it.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, unstable_serialize, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, replicaKeys } from '@/libs/replica';
import { CACHE_TIERS } from '@/libs/swr/localStorageProvider';
import { setScopedMutate } from '@/libs/swr/mutate';
import { messageService } from '@/services/message';
import {
  TOOL_RESULT_PAYLOAD_MAX_PERSISTED_CHARS,
  TOOL_RESULT_PAYLOAD_MAX_PERSISTED_ENTRIES,
  toolResultPayloadResource,
} from '@/services/message/replica';
import {
  initialToolResultPayloadState,
  useToolResultPayloadStore,
} from '@/store/toolResultPayload/store';

import { useToolResultPayload } from './useToolResultPayload';

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

/** Never-resolving read: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const storage = toolResultPayloadResource.storage!;

describe('useToolResultPayload replica', () => {
  const scopes = new Set<string>();
  const ids = new Set<string>();
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };
  const rowKey = (messageId: string, inScope = scope) => {
    ids.add(messageId);
    return { queryKey: toolResultPayloadResource.storageKey(messageId), scope: inScope };
  };
  /** A fresh session: empty memory, same IndexedDB. */
  const reload = () => act(() => useToolResultPayloadStore.setState(initialToolResultPayloadState));

  beforeEach(() => {
    useScope(`tool-payload-user-${randomUUID()}:personal`);
    reload();
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) => [...ids].map((id) => storage.remove(rowKey(id, value)))),
    );
    scopes.clear();
    ids.clear();
    vi.restoreAllMocks();
  });

  // Regression: the payload lived only in SWR's memory cache, so after a reload
  // opening the card showed the payload skeleton until the read returned.
  it('paints the persisted payload after a reload, then revalidates', async () => {
    const cached = { content: '# page body v1', pluginState: { url: 'https://example.com' } };
    await storage.set(rowKey('msg-1'), { data: { value: cached as any }, updatedAt: 1 });

    let resolveFresh!: (value: any) => void;
    const fetch = vi
      .spyOn(messageService, 'getToolResultPayload')
      .mockReturnValue(new Promise((resolve) => (resolveFresh = resolve)));

    const { result } = renderHook(() => useToolResultPayload('msg-1', true), { wrapper });

    await waitFor(() => expect(result.current).toEqual({ isLoading: false, payload: cached }));
    expect(fetch).toHaveBeenCalledWith('msg-1');

    const fresh = { content: '# page body v2' };
    await act(async () => resolveFresh(fresh));
    await waitFor(() => expect(result.current.payload).toEqual(fresh));
  });

  it('persists a fetched payload so the next session paints it without the network', async () => {
    const payload = { content: 'scraped body', pluginState: { status: 'ok' } };
    vi.spyOn(messageService, 'getToolResultPayload').mockResolvedValue(payload as any);
    const first = renderHook(() => useToolResultPayload('msg-2', true), { wrapper });
    await waitFor(() => expect(first.result.current.payload).toEqual(payload));
    await waitFor(async () =>
      expect((await storage.get(rowKey('msg-2')))?.data).toEqual({ value: payload }),
    );
    first.unmount();

    reload();
    vi.spyOn(messageService, 'getToolResultPayload').mockImplementation(pending);
    const second = renderHook(() => useToolResultPayload('msg-2', true), { wrapper });
    await waitFor(() => expect(second.result.current).toEqual({ isLoading: false, payload }));
  });

  it('shows the loading state and fetches nothing until enabled', async () => {
    const fetch = vi.spyOn(messageService, 'getToolResultPayload').mockImplementation(pending);
    const { result, rerender } = renderHook(
      ({ enabled }) => useToolResultPayload('msg-3', enabled),
      { initialProps: { enabled: false }, wrapper },
    );
    expect(result.current).toEqual({ isLoading: false, payload: undefined });
    expect(fetch).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('msg-3'));
    expect(result.current.isLoading).toBe(true);
  });

  it('keeps payloads over the size cap in memory only and drops an older row', async () => {
    await storage.set(rowKey('msg-big'), { data: { value: { content: 'old' } }, updatedAt: 1 });
    const huge = { content: 'x'.repeat(TOOL_RESULT_PAYLOAD_MAX_PERSISTED_CHARS + 1) };
    vi.spyOn(messageService, 'getToolResultPayload').mockResolvedValue(huge as any);

    const { result } = renderHook(() => useToolResultPayload('msg-big', true), { wrapper });
    await waitFor(() => expect(result.current.payload).toEqual(huge));
    await waitFor(async () => expect(await storage.get(rowKey('msg-big'))).toBeUndefined());
  });

  it('never paints another identity’s payload', async () => {
    await storage.set(rowKey('msg-4'), { data: { value: { content: 'mine' } }, updatedAt: 1 });
    useScope(`tool-payload-other-${randomUUID()}:personal`);
    vi.spyOn(messageService, 'getToolResultPayload').mockImplementation(pending);

    const { result } = renderHook(() => useToolResultPayload('msg-4', true), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.payload).toBeUndefined();
  });

  it('evicts the least recently opened payload past the entry cap', async () => {
    vi.spyOn(messageService, 'getToolResultPayload').mockImplementation(
      async (id) => ({ content: `body of ${id}` }) as any,
    );
    const slice = useToolResultPayloadStore.getState().payload;
    const total = TOOL_RESULT_PAYLOAD_MAX_PERSISTED_ENTRIES + 1;
    for (let i = 0; i < total; i++) {
      ids.add(`msg-lru-${i}`);
      await slice.fetch(`msg-lru-${i}`);
    }

    await waitFor(async () => {
      expect(await storage.get(rowKey('msg-lru-0'))).toBeUndefined();
      expect(await storage.get(rowKey(`msg-lru-${total - 1}`))).toBeDefined();
    });
    expect(await storage.get(rowKey('msg-lru-1'))).toBeDefined();
  });

  it('is bounded, and its network read is not persisted again by the SWR cache', () => {
    expect(toolResultPayloadResource.maxPersistedEntries).toBe(
      TOOL_RESULT_PAYLOAD_MAX_PERSISTED_ENTRIES,
    );
    const syncKey = unstable_serialize(
      replicaKeys.sync(toolResultPayloadResource.name, 1, scope, 'msg_abc', 'msg_abc'),
    );
    const tiers: string[] = [...CACHE_TIERS.idb, ...CACHE_TIERS.local];
    expect(tiers.filter((pattern) => syncKey.includes(pattern))).toEqual([]);
  });
});
