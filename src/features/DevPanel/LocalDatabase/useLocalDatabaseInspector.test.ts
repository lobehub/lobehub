import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocalDatabaseInspector } from './useLocalDatabaseInspector';

const mocks = vi.hoisted(() => ({
  entriesByPrefix: vi.fn(),
  get: vi.fn(),
  keyGroupsByPrefix: vi.fn(),
  keysByPrefix: vi.fn(),
  listCollections: vi.fn(),
}));

vi.mock('@/libs/localDatabase', () => ({
  localDatabase: mocks,
}));

const TOPIC_KEY = 'replica:topicList:v1:user-a:agent_1';
const AGENT_KEY = 'replica:agentDetail:v1:user-a:agent_1';

describe('useLocalDatabaseInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listCollections.mockResolvedValue([
      { entryCount: 2, name: 'query-projections' },
      { entryCount: 1, name: 'swr-cache' },
    ]);
    mocks.keyGroupsByPrefix.mockImplementation(async (collection: string) =>
      collection === 'query-projections'
        ? [
            { entryCount: 1, name: 'agentDetail' },
            { entryCount: 1, name: 'topicList' },
          ]
        : [],
    );
    mocks.keysByPrefix.mockImplementation(async (collection: string, prefix: string) => {
      if (collection !== 'query-projections') return { keys: ['message:list'], total: 1 };
      const keys = [AGENT_KEY, TOPIC_KEY].filter((key) => key.startsWith(prefix));
      return { keys, total: keys.length };
    });
    mocks.get.mockResolvedValue({ data: { id: 'agent_1' }, updatedAt: 0 });
  });

  it('opens the first collection with one bounded key query and reads no values', async () => {
    const { result } = renderHook(() => useLocalDatabaseInspector());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.selectedCollection).toBe('query-projections');
    expect(result.current.keys).toEqual([AGENT_KEY, TOPIC_KEY]);
    expect(result.current.matchingCount).toBe(2);
    expect(result.current.resources.map(({ name }) => name)).toEqual(['agentDetail', 'topicList']);
    expect(mocks.keysByPrefix).toHaveBeenCalledExactlyOnceWith('query-projections', '', {
      limit: 300,
      search: '',
    });
    expect(mocks.entriesByPrefix).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(result.current.selectedKey).toBeNull();
  });

  it('loads a single value only for the selected row', async () => {
    const { result } = renderHook(() => useLocalDatabaseInspector());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.selectKey(AGENT_KEY));

    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('query-projections', AGENT_KEY);
    expect(result.current.selectedEntry).toEqual({
      key: AGENT_KEY,
      value: { data: { id: 'agent_1' }, updatedAt: 0 },
    });
    expect(mocks.entriesByPrefix).not.toHaveBeenCalled();
  });

  it('pushes resource and search filters down to the key query', async () => {
    const { result } = renderHook(() => useLocalDatabaseInspector());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.selectKey(AGENT_KEY));
    await act(() => result.current.selectResource('topicList'));

    expect(result.current.selectedResource).toBe('topicList');
    expect(result.current.keys).toEqual([TOPIC_KEY]);
    expect(result.current.selectedKey).toBeNull();
    expect(result.current.selectedEntry).toBeNull();
    expect(mocks.keysByPrefix).toHaveBeenLastCalledWith('query-projections', 'replica:topicList:', {
      limit: 300,
      search: '',
    });

    await act(() => result.current.setSearch('agent_1'));

    expect(result.current.search).toBe('agent_1');
    expect(mocks.keysByPrefix).toHaveBeenLastCalledWith('query-projections', 'replica:topicList:', {
      limit: 300,
      search: 'agent_1',
    });
  });

  it('switches collections and preserves the selection when refreshed', async () => {
    const { result } = renderHook(() => useLocalDatabaseInspector());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.selectCollection('swr-cache'));
    expect(result.current.selectedCollection).toBe('swr-cache');
    expect(result.current.keys).toEqual(['message:list']);

    await act(() => result.current.selectKey('message:list'));
    mocks.listCollections.mockResolvedValue([
      { entryCount: 2, name: 'query-projections' },
      { entryCount: 2, name: 'swr-cache' },
    ]);
    mocks.keysByPrefix.mockResolvedValueOnce({ keys: ['message:list', 'topic:list'], total: 2 });
    mocks.get.mockResolvedValueOnce({ data: ['fresh'] });

    await act(() => result.current.refresh());

    expect(result.current.selectedCollection).toBe('swr-cache');
    expect(result.current.keys).toHaveLength(2);
    expect(result.current.collections[1].entryCount).toBe(2);
    expect(result.current.selectedEntry).toEqual({
      key: 'message:list',
      value: { data: ['fresh'] },
    });
  });
});
