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
import { homeService } from '@/services/home';
import { getAgentStoreState } from '@/store/agent';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import { reorderItems } from './action';
import { initialAgentListState } from './initialState';
import { agentListResource } from './projection';

vi.mock('@/store/agent', () => ({
  getAgentStoreState: vi.fn(() => ({
    invalidateAvailableAgents: vi.fn(),
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

  it('reorders the pinned rows right away, saves in order, and rolls back on failure', async () => {
    vi.spyOn(homeService, 'getSidebarAgentList').mockResolvedValue(
      response({ pinned: [agent('a'), agent('b'), agent('c')] }),
    );
    sync();
    await waitFor(() => expect(useHomeStore.getState().pinnedAgents).toHaveLength(3));
    const pinnedIds = () => useHomeStore.getState().pinnedAgents.map((item) => item.id);

    let reject!: (error: Error) => void;
    const save = vi
      .spyOn(homeService, 'updatePinnedOrder')
      .mockImplementation(() => new Promise<void>((_, fail) => (reject = fail)));

    const reorder = useHomeStore.getState().reorderPinnedAgents(['c', 'a', 'b']);
    expect(pinnedIds()).toEqual(['c', 'a', 'b']);
    await waitFor(() => expect(save).toHaveBeenCalledWith(['c', 'a', 'b']));

    reject(new Error('boom'));
    await expect(reorder).rejects.toThrow('boom');
    expect(pinnedIds()).toEqual(['a', 'b', 'c']);
  });
});

describe('updateRecommendedAgents', () => {
  it('shows the new list right away, drops unknown rows, and rolls back on failure', async () => {
    vi.spyOn(homeService, 'getSidebarAgentList').mockResolvedValue(
      response({ recommendedIds: ['a'], ungrouped: [agent('a'), agent('b')] }),
    );
    sync();
    await waitFor(() => expect(useHomeStore.getState().recommendedAgentIds).toEqual(['a']));

    let reject!: (error: Error) => void;
    const save = vi
      .spyOn(homeService, 'updateRecommendedAgents')
      .mockImplementation(() => new Promise<void>((_, fail) => (reject = fail)));

    // `gone` was deleted (or made private) since it was recommended.
    const update = useHomeStore.getState().updateRecommendedAgents(['b', 'gone', 'a']);
    expect(useHomeStore.getState().recommendedAgentIds).toEqual(['b', 'a']);
    await waitFor(() => expect(save).toHaveBeenCalledWith(['b', 'a']));

    reject(new Error('boom'));
    await expect(update).rejects.toThrow('boom');
    expect(useHomeStore.getState().recommendedAgentIds).toEqual(['a']);
  });
});

describe('updateRecommendedAgents ordering', () => {
  it('saves quick successive changes one after another, in order', async () => {
    vi.spyOn(homeService, 'getSidebarAgentList').mockResolvedValue(
      response({ recommendedIds: ['a', 'b'], ungrouped: [agent('a'), agent('b')] }),
    );
    sync();
    await waitFor(() => expect(useHomeStore.getState().recommendedAgentIds).toEqual(['a', 'b']));

    const pending: Array<() => void> = [];
    const save = vi
      .spyOn(homeService, 'updateRecommendedAgents')
      .mockImplementation(() => new Promise<void>((resolve) => pending.push(resolve)));

    const first = useHomeStore.getState().updateRecommendedAgents(['b', 'a']);
    const second = useHomeStore.getState().updateRecommendedAgents(['a', 'b']);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    // The second save waits for the first instead of racing it.
    expect(save).toHaveBeenLastCalledWith(['b', 'a']);

    pending[0]();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith(['a', 'b']);
    pending[1]();
    await act(() => Promise.all([first, second]));
    expect(useHomeStore.getState().recommendedAgentIds).toEqual(['a', 'b']);
  });
});

describe('reorderPinnedAgents across a scope change', () => {
  it.each([
    ['another workspace', (from: string) => from.replace(/:[^:]*$/, ':ws-2')],
    // Same workspace slot, different account: comparing only the workspace
    // would let user A's order go out on user B's session.
    ['another account in the same workspace', (from: string) => `other-user:${from.split(':')[1]}`],
  ])('drops a save still queued after switching to %s', async (_, next) => {
    vi.spyOn(homeService, 'getSidebarAgentList').mockResolvedValue(
      response({ pinned: [agent('a'), agent('b'), agent('c')] }),
    );
    sync();
    await waitFor(() => expect(useHomeStore.getState().pinnedAgents).toHaveLength(3));

    let finishFirst!: () => void;
    const save = vi
      .spyOn(homeService, 'updatePinnedOrder')
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishFirst = resolve)))
      .mockResolvedValue(undefined);

    const first = useHomeStore.getState().reorderPinnedAgents(['c', 'a', 'b']);
    const second = useHomeStore.getState().reorderPinnedAgents(['b', 'c', 'a']);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    scope = next(scope);
    finishFirst();
    // The skipped save is not an error for the caller.
    await act(() => Promise.all([first, second]));

    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('reorderItems', () => {
  it('puts the named rows first in order and keeps the rest after them', () => {
    const items = [agent('a'), agent('b'), agent('c'), agent('d')];
    expect(reorderItems(items, ['c', 'gone', 'a']).map((item) => item.id)).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
  });
});
