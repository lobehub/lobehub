// @vitest-environment happy-dom

import type { ChatTopic, RecentTopic } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { topicService } from '@/services/topic';
import { useEvalStore } from '@/store/eval';

const scope = vi.hoisted(() => ({ workspaceId: undefined as string | undefined }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => scope.workspaceId,
  useActiveWorkspaceId: () => scope.workspaceId,
}));
vi.mock('@/services/topic', () => ({
  topicService: { getRecentTopics: vi.fn(), searchTopics: vi.fn() },
}));

const recent = (id: string, type: RecentTopic['type'] = 'agent'): RecentTopic => ({
  agent: null,
  group: null,
  id,
  title: id,
  type,
  updatedAt: new Date(0),
});
const searchResult = (id: string): ChatTopic =>
  ({ id, title: id, updatedAt: new Date(0) }) as unknown as ChatTopic;

const createWrapper = () => {
  const cache = new Map();
  return ({ children }: PropsWithChildren) =>
    createElement(
      SWRConfig,
      { value: { provider: () => cache, shouldRetryOnError: false } },
      children,
    );
};

const actions = {
  useFetchConversationTopics: (query: string) =>
    useEvalStore.getState().useFetchConversationTopics(query),
};

beforeEach(() => {
  scope.workspaceId = undefined;
  vi.resetAllMocks();
  // Picker results live in the store, partitioned like the cache by workspace.
  const current = () => `eval-user:${scope.workspaceId ?? 'personal'}`;
  vi.spyOn(cacheScope, 'get').mockImplementation(current);
  vi.spyOn(cacheScope, 'use').mockImplementation(current);
  useEvalStore.setState({ conversationTopicMap: {} });
});
afterEach(() => vi.restoreAllMocks());

describe('eval conversation picker requests', () => {
  it('exposes an initial failure, then recovers with a retry rather than reporting empty', async () => {
    const failure = new Error('Service unavailable');
    vi.mocked(topicService.getRecentTopics)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce([recent('topic-a'), recent('group-a', 'group')]);
    const { result } = renderHook(() => ({ ...actions.useFetchConversationTopics('') }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).toBe(failure));
    expect(result.current.data).toBeUndefined();
    await act(async () => {
      await result.current.mutate();
    });
    expect(result.current.error).toBeUndefined();
    expect(result.current.data?.map((topic) => topic.id)).toEqual(['topic-a']);
  });

  it('keeps a settled empty result when background revalidation fails', async () => {
    vi.mocked(topicService.getRecentTopics).mockResolvedValueOnce([]);
    const { result } = renderHook(() => ({ ...actions.useFetchConversationTopics('') }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual([]));

    vi.mocked(topicService.getRecentTopics).mockRejectedValueOnce(new Error('Refresh failed'));
    await act(async () => {
      await result.current.mutate().catch(() => undefined);
    });
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('does not replace a newer search with a late response to an older query', async () => {
    let resolveOlder!: (value: ChatTopic[]) => void;
    vi.mocked(topicService.searchTopics).mockImplementation((query) =>
      query === 'older'
        ? new Promise((resolve) => {
            resolveOlder = resolve;
          })
        : Promise.resolve([searchResult('newer-result')]),
    );
    const { result, rerender } = renderHook(
      ({ query }) => ({ ...actions.useFetchConversationTopics(query) }),
      { initialProps: { query: 'older' }, wrapper: createWrapper() },
    );

    rerender({ query: 'newer' });
    await waitFor(() => expect(result.current.data?.[0].id).toBe('newer-result'));
    await act(async () => resolveOlder([searchResult('older-result')]));
    expect(result.current.data?.[0].id).toBe('newer-result');
  });

  it('does not show another workspace’s recent topics while the new scope loads', async () => {
    vi.mocked(topicService.getRecentTopics).mockResolvedValueOnce([recent('personal-topic')]);
    const { result, rerender } = renderHook(() => ({ ...actions.useFetchConversationTopics('') }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.data?.[0].id).toBe('personal-topic'));

    let resolveWorkspace!: (value: RecentTopic[]) => void;
    vi.mocked(topicService.getRecentTopics).mockImplementationOnce(
      () => new Promise((resolve) => (resolveWorkspace = resolve)),
    );
    scope.workspaceId = 'workspace-b';
    rerender();
    expect(result.current.data).toBeUndefined();
    await act(async () => resolveWorkspace([recent('workspace-topic')]));
    await waitFor(() => expect(result.current.data?.[0].id).toBe('workspace-topic'));
  });
});
