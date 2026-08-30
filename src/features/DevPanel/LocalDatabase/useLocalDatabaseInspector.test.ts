import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocalDatabaseInspector } from './useLocalDatabaseInspector';

const mocks = vi.hoisted(() => ({
  entriesByPrefix: vi.fn(),
  listCollections: vi.fn(),
}));

vi.mock('@/libs/localDatabase', () => ({
  localDatabase: mocks,
}));

describe('useLocalDatabaseInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listCollections.mockResolvedValue([
      { entryCount: 2, name: 'projection_agents' },
      { entryCount: 1, name: 'swr-cache' },
    ]);
    mocks.entriesByPrefix.mockImplementation(async (collection: string) =>
      collection === 'projection_agents'
        ? [
            { key: 'agent::1', value: { id: '1' } },
            { key: 'topic::2', value: { id: '2' } },
          ]
        : [{ key: 'message:list', value: { data: [] } }],
    );
  });

  it('discovers collections and opens the first collection as a readable snapshot', async () => {
    const { result } = renderHook(() => useLocalDatabaseInspector());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.selectedCollection).toBe('projection_agents');
    expect(result.current.entries).toHaveLength(2);
    expect(mocks.entriesByPrefix).toHaveBeenCalledWith('projection_agents', '');
  });

  it('switches collections and preserves the selected collection when refreshed', async () => {
    const { result } = renderHook(() => useLocalDatabaseInspector());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.selectCollection('swr-cache'));
    expect(result.current.selectedCollection).toBe('swr-cache');
    expect(result.current.entries).toEqual([{ key: 'message:list', value: { data: [] } }]);

    mocks.listCollections.mockResolvedValue([
      { entryCount: 2, name: 'projection_agents' },
      { entryCount: 2, name: 'swr-cache' },
    ]);
    mocks.entriesByPrefix.mockResolvedValueOnce([
      { key: 'message:list', value: { data: [] } },
      { key: 'topic:list', value: { data: ['topic-1'] } },
    ]);

    await act(() => result.current.refresh());

    expect(result.current.selectedCollection).toBe('swr-cache');
    expect(result.current.entries).toHaveLength(2);
    expect(result.current.collections[1].entryCount).toBe(2);
  });
});
