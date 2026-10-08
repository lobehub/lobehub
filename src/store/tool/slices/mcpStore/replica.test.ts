/**
 * @vitest-environment happy-dom
 *
 * The MCP marketplace list is a `@lobechat/replica` paged resource: the
 * persisted head page paints before the network answers, the response confirms
 * and persists it, "load more" appends through the engine, and a query change
 * (search term) repaints from its own head page instead of appending to the
 * previous search.
 */
import { randomUUID } from 'node:crypto';

import type { PluginItem } from '@lobehub/market-sdk';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { discoverService } from '@/services/discover';
import { globalHelpers } from '@/store/global/helpers';
import { McpConnectionType, type McpListResponse } from '@/types/discover';

import { useToolStore } from '../../store';
import { initialMCPStoreState, type MCPPluginListData } from './initialState';
import { MCP_PLUGIN_LIST_KEY, type MCPPluginListParams, mcpPluginListResource } from './projection';

const BASE_PARAMS: MCPPluginListParams = {
  connectionType: McpConnectionType.http,
  locale: 'en-US',
  pageSize: 20,
};
const SEARCH_PARAMS: MCPPluginListParams = { ...BASE_PARAMS, q: 'foo' };
const BASE_KEY = mcpPluginListResource.storageKey(BASE_PARAMS);
const SEARCH_KEY = mcpPluginListResource.storageKey(SEARCH_PARAMS);

const plugin = (identifier: string): PluginItem => ({ identifier, name: identifier }) as PluginItem;

const ids = (data?: MCPPluginListData) => data?.items.map((item) => item.identifier);

const idsOf = (length: number, offset = 0) =>
  Array.from({ length }, (_, i) => `plugin-${i + offset}`).map(plugin);

const listPage = (items: PluginItem[], totalCount: number): McpListResponse => ({
  categories: [],
  currentPage: 1,
  items,
  pageSize: 20,
  totalCount,
  totalPages: Math.ceil(totalCount / 20),
});

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

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

describe('mcpPluginList replica', () => {
  const scopes = new Set<string>();
  let scope = '';
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`mcp-user-${randomUUID()}:personal`);
    vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');
    fetchSpy = vi.spyOn(discoverService, 'getMCPPluginList');
    act(() => useToolStore.setState(initialMCPStoreState));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) =>
        [BASE_KEY, SEARCH_KEY].map((queryKey) =>
          mcpPluginListResource.storage!.remove({ queryKey, scope: value }),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('reads the list from a single scope entry', () => {
    expect(MCP_PLUGIN_LIST_KEY).toBe('all');
  });

  it('paints the persisted head page before the network answers', async () => {
    const cached: MCPPluginListData = {
      connectionType: McpConnectionType.http,
      currentPage: 0,
      hasMore: true,
      items: [plugin('cached-1')],
      locale: 'en-US',
      pageSize: 20,
      total: 40,
    };
    await mcpPluginListResource.storage!.set(
      { queryKey: BASE_KEY, scope },
      { data: cached, updatedAt: 1 },
    );
    fetchSpy.mockImplementation(pending);

    const hook = renderHook(
      () => ({
        list: useToolStore((s) => s.mcpPluginList),
        sync: useToolStore((s) => s.useFetchMCPPluginList)({ pageSize: 20 }),
      }),
      { wrapper },
    );

    await waitFor(() => expect(ids(useToolStore.getState().mcpPluginList)).toEqual(['cached-1']));
    expect(hook.result.current.sync.isHydrated).toBe(true);
    expect(hook.result.current.sync.isValidating).toBe(true);
  });

  it('replaces the head page with the server response and persists it', async () => {
    fetchSpy.mockResolvedValue(listPage([plugin('a'), plugin('b')], 40));

    renderHook(() => useToolStore((s) => s.useFetchMCPPluginList)({ pageSize: 20 }), { wrapper });

    await waitFor(() => expect(ids(useToolStore.getState().mcpPluginList)).toEqual(['a', 'b']));
    expect(useToolStore.getState().mcpPluginList).toMatchObject({ hasMore: true, total: 40 });

    await waitFor(async () => {
      const row = await mcpPluginListResource.storage!.get({ queryKey: BASE_KEY, scope });
      expect(ids(row?.data as MCPPluginListData)).toEqual(['a', 'b']);
    });
  });

  it('appends the next page with the loaded query params', async () => {
    fetchSpy
      .mockResolvedValueOnce(listPage(idsOf(20), 40))
      .mockResolvedValueOnce(listPage(idsOf(20, 20), 40));

    const hook = renderHook(
      () => ({
        loadMore: useToolStore((s) => s.loadMoreMCPPlugins),
        sync: useToolStore((s) => s.useFetchMCPPluginList)({ pageSize: 20 }),
      }),
      { wrapper },
    );

    await waitFor(() => expect(useToolStore.getState().mcpPluginList?.items).toHaveLength(20));

    await act(async () => {
      await hook.result.current.loadMore();
    });

    const list = useToolStore.getState().mcpPluginList!;
    expect(list.items).toHaveLength(40);
    expect(list.items[20].identifier).toBe('plugin-20');
    expect(list.currentPage).toBe(1);
    expect(list.hasMore).toBe(false);
    // The replica owns the cursor: page 2 of the loaded query.
    expect(fetchSpy).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 20 }));
  });

  it('repaints from its own head page when the query changes', async () => {
    fetchSpy
      .mockResolvedValueOnce(listPage(idsOf(20), 40))
      .mockResolvedValueOnce(listPage(idsOf(20, 20), 40))
      .mockResolvedValueOnce(listPage([plugin('foo-1')], 1));

    const hook = renderHook(
      (props: { q?: string }) =>
        useToolStore((s) => s.useFetchMCPPluginList)({ pageSize: 20, q: props.q }),
      { initialProps: {} as { q?: string }, wrapper },
    );

    await waitFor(() => expect(useToolStore.getState().mcpPluginList?.items).toHaveLength(20));
    await act(async () => {
      await useToolStore.getState().loadMoreMCPPlugins();
    });
    expect(useToolStore.getState().mcpPluginList?.items).toHaveLength(40);

    hook.rerender({ q: 'foo' });

    await waitFor(() => expect(ids(useToolStore.getState().mcpPluginList)).toEqual(['foo-1']));
    // A different query resets the loaded depth; it never merges into the previous search.
    expect(useToolStore.getState().mcpPluginList).toMatchObject({
      currentPage: 0,
      q: 'foo',
      total: 1,
    });
  });

  it('drops the painted page set on reset but keeps the persisted row', async () => {
    fetchSpy.mockResolvedValue(listPage([plugin('a')], 1));

    renderHook(() => useToolStore((s) => s.useFetchMCPPluginList)({ pageSize: 20 }), { wrapper });

    await waitFor(() => expect(ids(useToolStore.getState().mcpPluginList)).toEqual(['a']));
    await waitFor(async () =>
      expect(
        (await mcpPluginListResource.storage!.get({ queryKey: BASE_KEY, scope }))?.data,
      ).toBeDefined(),
    );

    act(() => useToolStore.getState().resetMCPPluginList('gone'));

    expect(useToolStore.getState().mcpPluginList).toBeUndefined();
    expect(useToolStore.getState().mcpSearchKeywords).toBe('gone');
    const row = await mcpPluginListResource.storage!.get({ queryKey: BASE_KEY, scope });
    expect(ids(row?.data as MCPPluginListData)).toEqual(['a']);
  });

  it('does not fetch another page when the head page is the last one', async () => {
    fetchSpy.mockResolvedValue(listPage([plugin('only')], 1));

    const hook = renderHook(
      () => ({
        loadMore: useToolStore((s) => s.loadMoreMCPPlugins),
        sync: useToolStore((s) => s.useFetchMCPPluginList)({ pageSize: 20 }),
      }),
      { wrapper },
    );

    await waitFor(() => expect(useToolStore.getState().mcpPluginList?.items).toHaveLength(1));
    expect(useToolStore.getState().mcpPluginList?.hasMore).toBe(false);

    await act(async () => {
      await hook.result.current.loadMore();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
