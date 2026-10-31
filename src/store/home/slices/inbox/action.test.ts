/**
 * @vitest-environment happy-dom
 *
 * The home inbox feed and the daily brief are replicas: a reload paints the
 * persisted value on the first frame and the server only confirms it.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { homeService } from '@/services/home';
import { type TopicListItem, topicService } from '@/services/topic';
import { useHomeStore } from '@/store/home';
import { initialHomeInboxState } from '@/store/home/slices/inbox/initialState';
import {
  HOME_DAILY_BRIEF_KEY,
  HOME_INBOX_KEY,
  homeDailyBriefResource,
  homeInboxTopicsResource,
} from '@/store/home/slices/inbox/projection';
import { homeInboxSelectors } from '@/store/home/slices/inbox/selectors';

const topic = (id: string, status: TopicListItem['status']): TopicListItem =>
  ({ createdAt: 0, id, status, title: id, updatedAt: 0 }) as unknown as TopicListItem;

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

let scope = '';
const useScope = (next: string) => {
  scope = next;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
};

const never = <T>() => new Promise<T>(() => {});

beforeEach(() => {
  useScope(`inbox-user-${randomUUID()}:personal`);
  act(() => useHomeStore.setState({ ...initialHomeInboxState }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('home inbox replica', () => {
  it('paints the persisted inbox rows before the network answers', async () => {
    await homeInboxTopicsResource.storage!.set(
      { queryKey: HOME_INBOX_KEY, scope },
      { data: [topic('a', 'unread'), topic('b', 'running')], updatedAt: 1 },
    );
    vi.spyOn(topicService, 'queryTopics').mockImplementation(never);

    const { result } = renderHook(() => useHomeStore((s) => s.useFetchHomeInboxTopics)(true), {
      wrapper,
    });

    await waitFor(() =>
      expect(homeInboxSelectors.inboxTopics(useHomeStore.getState())?.map((t) => t.id)).toEqual([
        'a',
        'b',
      ]),
    );
    expect(result.current.isValidating).toBe(true);
  });

  it('persists a fetched feed under the active scope only', async () => {
    vi.spyOn(topicService, 'queryTopics').mockResolvedValue([topic('a', 'unread')]);

    renderHook(() => useHomeStore((s) => s.useFetchHomeInboxTopics)(true), { wrapper });

    await waitFor(async () =>
      expect(
        (await homeInboxTopicsResource.storage!.get({ queryKey: HOME_INBOX_KEY, scope }))?.data,
      ).toHaveLength(1),
    );
    expect(
      await homeInboxTopicsResource.storage!.get({
        queryKey: HOME_INBOX_KEY,
        scope: 'someone-else:personal',
      }),
    ).toBeUndefined();
  });

  it('does not fetch while logged out', () => {
    const queryTopics = vi.spyOn(topicService, 'queryTopics');
    renderHook(() => useHomeStore((s) => s.useFetchHomeInboxTopics)(false), { wrapper });
    expect(queryTopics).not.toHaveBeenCalled();
  });

  it('promotes a replied topic to running at once, then reconciles with the server', async () => {
    const queryTopics = vi
      .spyOn(topicService, 'queryTopics')
      .mockResolvedValueOnce([topic('a', 'unread')])
      .mockResolvedValue([topic('a', 'running')]);
    renderHook(() => useHomeStore((s) => s.useFetchHomeInboxTopics)(true), { wrapper });
    await waitFor(() =>
      expect(homeInboxSelectors.inboxTopics(useHomeStore.getState())).toBeDefined(),
    );

    act(() => useHomeStore.getState().promoteInboxTopicToRunning('a'));

    expect(homeInboxSelectors.inboxTopics(useHomeStore.getState())?.[0].status).toBe('running');
    await waitFor(() => expect(queryTopics).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(homeInboxSelectors.inboxTopics(useHomeStore.getState())?.[0].status).toBe('running');
  });
});

describe('home daily brief replica', () => {
  it('paints the persisted brief before the network answers', async () => {
    await homeDailyBriefResource.storage!.set(
      { queryKey: HOME_DAILY_BRIEF_KEY, scope },
      { data: { pairs: [{ hint: 'cached hint', welcome: 'cached welcome' }] }, updatedAt: 1 },
    );
    vi.spyOn(homeService, 'getDailyBrief').mockImplementation(never);

    renderHook(() => useHomeStore((s) => s.useFetchHomeDailyBrief)(true), { wrapper });

    await waitFor(() =>
      expect(homeInboxSelectors.dailyBrief(useHomeStore.getState())?.pairs[0].welcome).toBe(
        'cached welcome',
      ),
    );
  });

  it("never paints another identity's brief", async () => {
    await homeDailyBriefResource.storage!.set(
      { queryKey: HOME_DAILY_BRIEF_KEY, scope: 'previous-user:personal' },
      { data: { pairs: [{ hint: 'theirs', welcome: 'theirs' }] }, updatedAt: 1 },
    );
    vi.spyOn(homeService, 'getDailyBrief').mockResolvedValue({
      pairs: [{ hint: 'mine', welcome: 'mine' }],
    });

    renderHook(() => useHomeStore((s) => s.useFetchHomeDailyBrief)(true), { wrapper });

    await waitFor(() =>
      expect(homeInboxSelectors.dailyBrief(useHomeStore.getState())?.pairs[0].welcome).toBe('mine'),
    );
  });
});
