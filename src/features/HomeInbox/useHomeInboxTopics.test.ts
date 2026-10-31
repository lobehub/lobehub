/**
 * @vitest-environment happy-dom
 *
 * A reload paints the persisted inbox and flags the in-flight refresh, so the
 * section heading can show it is still confirming the rows on screen.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { type TopicListItem, topicService } from '@/services/topic';
import { useHomeStore } from '@/store/home';
import { initialHomeInboxState } from '@/store/home/slices/inbox/initialState';
import { HOME_INBOX_KEY, homeInboxTopicsResource } from '@/store/home/slices/inbox/projection';

import { useHomeInboxTopics } from './useHomeInboxTopics';

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

beforeEach(() => {
  scope = `inbox-hook-${randomUUID()}:personal`;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  act(() => useHomeStore.setState({ ...initialHomeInboxState }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useHomeInboxTopics', () => {
  it('reports a refresh over the persisted rows, then clears it when the server answers', async () => {
    await homeInboxTopicsResource.storage!.set(
      { queryKey: HOME_INBOX_KEY, scope },
      { data: [topic('cached', 'unread')], updatedAt: 1 },
    );
    let answer!: (rows: TopicListItem[]) => void;
    vi.spyOn(topicService, 'queryTopics').mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );

    const { result } = renderHook(() => useHomeInboxTopics(true), { wrapper });

    await waitFor(() => expect(result.current.unread.map((t) => t.id)).toEqual(['cached']));
    expect(result.current.isInit).toBe(true);
    expect(result.current.isRefreshing).toBe(true);

    await act(async () => answer([topic('fresh', 'unread')]));

    await waitFor(() => expect(result.current.unread.map((t) => t.id)).toEqual(['fresh']));
    expect(result.current.isRefreshing).toBe(false);
  });

  it('does not claim a refresh on a cold load with nothing to show yet', async () => {
    vi.spyOn(topicService, 'queryTopics').mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useHomeInboxTopics(true), { wrapper });

    await waitFor(() => expect(result.current.isInit).toBe(false));
    expect(result.current.isRefreshing).toBe(false);
  });
});
