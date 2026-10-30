/**
 * @vitest-environment happy-dom
 *
 * The sidebar agent list is a replica whose view is the store's flat bucket
 * fields: it paints from localStorage on the first frame, and a rename shows
 * in whichever bucket (pinned, folder, private …) holds the agent.
 */
import { randomUUID } from 'node:crypto';

import type { SidebarAgentItem, SidebarAgentListResponse } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentService } from '@/services/agent';
import { homeService } from '@/services/home';
import { getAgentStoreState } from '@/store/agent';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { initialAgentListState } from './initialState';
import { agentListResource } from './projection';

vi.mock('@/store/agent', () => ({
  getAgentStoreState: vi.fn(() => ({
    invalidateAvailableAgents: vi.fn(),
    markAgentDeleted: vi.fn(),
    updateAgentMetaById: vi.fn(),
  })),
}));

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

const UPDATED_AT = new Date('2026-01-01T00:00:00.000Z');
const agent = (id: string, title = id): SidebarAgentItem =>
  ({ id, pinned: false, title, type: 'agent', updatedAt: UPDATED_AT }) as SidebarAgentItem;

const response = (overrides: Partial<SidebarAgentListResponse> = {}): SidebarAgentListResponse => ({
  groups: [],
  pinned: [],
  privateGroups: [],
  privatePinned: [],
  privateUngrouped: [],
  ungrouped: [],
  ...overrides,
});

let scope = '';
beforeEach(() => {
  scope = `agent-list-user-${randomUUID()}:personal`;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  act(() => useHomeStore.setState({ ...initialAgentListState }));
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const sync = () => renderHook(() => useHomeStore((s) => s.useFetchAgentList)(true), { wrapper });

describe('sidebar agent list replica', () => {
  it('keeps a confirmed deletion out of the sidebar when the refresh is offline', async () => {
    const getList = vi
      .spyOn(homeService, 'getSidebarAgentList')
      .mockResolvedValue(response({ pinned: [agent('deleted')] }));
    await useHomeStore.getState().fetchAgentList();
    vi.spyOn(agentService, 'removeAgent').mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getList.mockRejectedValue(new Error('offline'));
    await expect(useHomeStore.getState().removeAgent('deleted')).resolves.toBeUndefined();
    expect(homeAgentListSelectors.allAgents(useHomeStore.getState())).toEqual([]);
  });

  it('removes a deleted Agent even when an older sidebar request finishes afterwards', async () => {
    const list = response({ ungrouped: [agent('deleted')] });
    const getList = vi.spyOn(homeService, 'getSidebarAgentList').mockResolvedValue(list);
    await useHomeStore.getState().fetchAgentList();
    const old = Promise.withResolvers<SidebarAgentListResponse>();
    getList.mockReturnValueOnce(old.promise);
    const pending = useHomeStore.getState().fetchAgentList();
    vi.spyOn(agentService, 'removeAgent').mockResolvedValue(undefined);
    getList.mockResolvedValue(response());
    await useHomeStore.getState().removeAgent('deleted');
    old.resolve(list);
    await pending;
    expect(homeAgentListSelectors.allAgents(useHomeStore.getState())).toEqual([]);
  });

  it('paints the persisted list before the network answers', async () => {
    await agentListResource.storage!.set(
      { queryKey: agentListResource.storageKey({}), scope },
      { data: response({ pinned: [agent('a1', 'Cached')] }), updatedAt: 1 },
    );
    vi.spyOn(homeService, 'getSidebarAgentList').mockImplementation(() => new Promise(() => {}));

    sync();

    await waitFor(() => expect(useHomeStore.getState().isAgentListInit).toBe(true));
    expect(homeAgentListSelectors.pinnedAgents(useHomeStore.getState())[0].title).toBe('Cached');
  });

  it('keeps bucket references when the server returns an unchanged list', async () => {
    const list = response({ ungrouped: [agent('a1')] });
    const getList = vi
      .spyOn(homeService, 'getSidebarAgentList')
      .mockResolvedValue(structuredClone(list));
    sync();
    await waitFor(() => expect(useHomeStore.getState().ungroupedAgents).toHaveLength(1));
    const before = useHomeStore.getState().ungroupedAgents;

    getList.mockResolvedValue(structuredClone(list));
    await act(() => useHomeStore.getState().refreshAgentList());

    expect(useHomeStore.getState().ungroupedAgents).toBe(before);
  });

  it('renames the agent in its folder right away and rolls back on failure', async () => {
    vi.spyOn(homeService, 'getSidebarAgentList').mockResolvedValue(
      response({
        groups: [{ id: 'g1', items: [agent('a1', 'Old')], title: 'Folder' } as any],
        privatePinned: [agent('a2')],
      }),
    );
    sync();
    await waitFor(() => expect(useHomeStore.getState().agentGroups).toHaveLength(1));

    let reject!: (error: Error) => void;
    const updateAgentMetaById = vi.fn(() => new Promise<void>((_, fail) => (reject = fail)));
    vi.mocked(getAgentStoreState).mockReturnValue({
      invalidateAvailableAgents: vi.fn(),
      updateAgentMetaById,
    } as any);

    const rename = useHomeStore.getState().updateAgentMeta('a1', { title: 'New' });
    expect(useHomeStore.getState().agentGroups[0].items[0].title).toBe('New');
    // Other buckets are untouched.
    expect(useHomeStore.getState().privatePinnedAgents[0].title).toBe('a2');
    expect(updateAgentMetaById).toHaveBeenCalledWith('a1', { title: 'New' }, { rethrow: true });

    reject(new Error('boom'));
    await expect(rename).rejects.toThrow('boom');
    expect(useHomeStore.getState().agentGroups[0].items[0].title).toBe('Old');
  });
});
