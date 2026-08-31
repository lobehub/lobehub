import useSWR from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserMemoryStore } from '@/store/userMemory';
import { initialState } from '@/store/userMemory/initialState';

vi.mock('swr', () => ({ default: vi.fn(() => ({})) }));

const resultItem = (id: string) => ({ memory: { id }, preference: {} });

const getOnSuccess = (call: number) =>
  vi.mocked(useSWR).mock.calls[call][2]?.onSuccess as (data: {
    items: ReturnType<typeof resultItem>[];
    total: number;
  }) => void;

beforeEach(() => {
  vi.clearAllMocks();
  useUserMemoryStore.setState(
    {
      ...initialState,
      preferences: [{ id: 'existing' } as never],
      preferencesInit: true,
      preferencesPage: 2,
      preferencesQuery: undefined,
      preferencesSearchLoading: false,
      preferencesTotal: 22,
    },
    false,
  );
});

describe('preference actions', () => {
  it('ignores a late response from the list state that preceded a search', () => {
    useUserMemoryStore.getState().useFetchPreferences({ page: 2, pageSize: 12 });

    useUserMemoryStore.getState().resetPreferencesList({ q: 'late night' });
    useUserMemoryStore.getState().useFetchPreferences({ page: 1, pageSize: 12, q: 'late night' });

    getOnSuccess(1)({ items: [resultItem('matching')], total: 1 });
    getOnSuccess(0)({ items: [resultItem('stale')], total: 22 });

    expect(useUserMemoryStore.getState()).toMatchObject({
      preferences: [{ id: 'matching' }],
      preferencesSearchLoading: false,
      preferencesTotal: 1,
    });
  });

  it('accepts an earlier page when pagination advances before its response arrives', () => {
    useUserMemoryStore.getState().useFetchPreferences({ page: 2, pageSize: 12 });
    useUserMemoryStore.setState({ preferencesPage: 3 });

    getOnSuccess(0)({ items: [resultItem('page-2')], total: 22 });

    expect(useUserMemoryStore.getState().preferences).toEqual([
      { id: 'existing' },
      { id: 'page-2' },
    ]);
  });
});
