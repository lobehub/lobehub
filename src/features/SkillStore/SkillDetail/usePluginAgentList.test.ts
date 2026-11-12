/**
 * @vitest-environment happy-dom
 *
 * "Agents using this plugin / skill" reads one replica entry per page,
 * persisted to IndexedDB: reopening a detail paints the last confirmed first
 * page before the network answers. A hydrated empty page is not proof of "no
 * agents" until the server confirms it, and a failed refresh keeps the agents.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { discoverService } from '@/services/discover';
import {
  deferred,
  pending,
  replicaWrapper as wrapper,
  useReplicaHarness,
} from '@/store/discover/__tests__/replicaHarness';
import { pluginAgentsParams } from '@/store/discover/slices/market/action';
import { pluginAgentsQueryKey } from '@/store/discover/slices/market/projection';
import { globalHelpers } from '@/store/global/helpers';

import { usePluginAgentList } from './usePluginAgentList';

const page = (titles: string[], totalCount = titles.length) => ({
  currentPage: 1,
  items: titles.map((title) => ({ identifier: title, title })),
  pageSize: 12,
  totalCount,
  totalPages: 1,
});

const pageKey = (pluginId: string, n = 1) => pluginAgentsQueryKey(pluginAgentsParams(pluginId, n));
const titles = (items: { title?: string }[]) => items.map((item) => item.title);

describe('usePluginAgentList', () => {
  const { persist } = useReplicaHarness('plugin-agents');

  it('paints the persisted first page before the network answers, then refreshes it', async () => {
    await persist('discoverPluginAgents', pageKey('web-search'), page(['Cached agent']));
    const next = deferred<unknown>();
    vi.spyOn(discoverService, 'getAgentsByPlugin').mockImplementation(() => next.promise as never);

    const { result } = renderHook(() => usePluginAgentList('web-search'), { wrapper });

    await waitFor(() => expect(titles(result.current.items)).toEqual(['Cached agent']));
    expect(result.current.isInitialLoading).toBe(false);

    await act(async () => next.resolve(page(['Fresh agent'])));
    await waitFor(() => expect(titles(result.current.items)).toEqual(['Fresh agent']));
  });

  it('keeps loading over a hydrated empty page until the server confirms it', async () => {
    await persist('discoverPluginAgents', pageKey('web-search'), page([]));
    const next = deferred<unknown>();
    vi.spyOn(discoverService, 'getAgentsByPlugin').mockImplementation(() => next.promise as never);

    const { result } = renderHook(() => usePluginAgentList('web-search'), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.isEmpty).toBe(false);
    expect(result.current.isInitialLoading).toBe(true);

    await act(async () => next.resolve(page([])));
    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    expect(result.current.isInitialLoading).toBe(false);
  });

  it('keeps the agents when a refresh fails', async () => {
    await persist('discoverPluginAgents', pageKey('web-search'), page(['Cached agent']));
    const fetch = vi
      .spyOn(discoverService, 'getAgentsByPlugin')
      .mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => usePluginAgentList('web-search'), { wrapper });

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(titles(result.current.items)).toEqual(['Cached agent']);
    expect(result.current.error).toBeUndefined();
  });

  it('walks to the next page and appends it', async () => {
    vi.spyOn(discoverService, 'getAgentsByPlugin').mockImplementation(
      async ({ page: n }) => page([`Agent ${n}`], 2) as never,
    );

    const { result } = renderHook(() => usePluginAgentList('web-search'), { wrapper });
    await waitFor(() => expect(titles(result.current.items)).toEqual(['Agent 1']));

    act(() => result.current.loadMore());
    await waitFor(() => expect(titles(result.current.items)).toEqual(['Agent 1', 'Agent 2']));
  });

  it('keeps the agents and offers a retry when a later page fails', async () => {
    let fail = true;
    vi.spyOn(discoverService, 'getAgentsByPlugin').mockImplementation(async ({ page: n }) => {
      if (n === 2 && fail) throw new Error('rate limited');
      return page([`Agent ${n}`], 2) as never;
    });

    const { result } = renderHook(() => usePluginAgentList('web-search'), { wrapper });
    await waitFor(() => expect(titles(result.current.items)).toEqual(['Agent 1']));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.pageError).toBeInstanceOf(Error));
    expect(titles(result.current.items)).toEqual(['Agent 1']);
    expect(result.current.error).toBeUndefined();

    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(titles(result.current.items)).toEqual(['Agent 1', 'Agent 2']));
    expect(result.current.pageError).toBeUndefined();
  });

  it('starts another plugin from its first page', async () => {
    vi.spyOn(discoverService, 'getAgentsByPlugin').mockImplementation(
      async ({ page: n, pluginId }) => page([`${pluginId} ${n}`], 2) as never,
    );

    const { rerender, result } = renderHook(({ id }) => usePluginAgentList(id), {
      initialProps: { id: 'web-search' },
      wrapper,
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    rerender({ id: 'calculator' });
    await waitFor(() => expect(titles(result.current.items)).toEqual(['calculator 1']));
  });

  it('starts again from the first page when the UI language changes', async () => {
    let locale = 'en-US';
    vi.spyOn(globalHelpers, 'getCurrentLanguage').mockImplementation(() => locale as never);
    vi.spyOn(discoverService, 'getAgentsByPlugin').mockImplementation(
      async ({ page: n }) => page([`${locale} ${n}`], 2) as never,
    );

    const { rerender, result } = renderHook(() => usePluginAgentList('web-search'), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    locale = 'zh-CN';
    rerender();
    await waitFor(() => expect(titles(result.current.items)).toEqual(['zh-CN 1']));
    expect(result.current.isInitialLoading).toBe(false);
  });

  it("never paints another identity's agents", async () => {
    await persist(
      'discoverPluginAgents',
      pageKey('web-search'),
      page(['Theirs']),
      'someone-else:personal',
    );
    vi.spyOn(discoverService, 'getAgentsByPlugin').mockImplementation(pending);

    const { result } = renderHook(() => usePluginAgentList('web-search'), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.items).toEqual([]);
    expect(result.current.isInitialLoading).toBe(true);
  });
});
