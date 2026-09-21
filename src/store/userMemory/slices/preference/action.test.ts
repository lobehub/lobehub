import { beforeEach, describe, expect, it } from 'vitest';

import { useUserMemoryStore } from '@/store/userMemory';
import { initialState } from '@/store/userMemory/initialState';

const resultItem = (id: string) => ({ memory: { id }, preference: {} });

beforeEach(() => {
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
    useUserMemoryStore.getState().resetPreferencesList({ q: 'late night' });
    useUserMemoryStore
      .getState()
      .internal_acceptPreferencesList(
        { items: [resultItem('matching')], total: 1 },
        { page: 1, pageSize: 12, q: 'late night' },
      );
    useUserMemoryStore
      .getState()
      .internal_acceptPreferencesList(
        { items: [resultItem('stale')], total: 22 },
        { page: 2, pageSize: 12 },
      );

    expect(useUserMemoryStore.getState()).toMatchObject({
      preferences: [{ id: 'matching' }],
      preferencesSearchLoading: false,
      preferencesTotal: 1,
    });
  });

  it('accepts an earlier page when pagination advances before its response arrives', () => {
    useUserMemoryStore.setState({ preferencesPage: 3 });
    useUserMemoryStore
      .getState()
      .internal_acceptPreferencesList(
        { items: [resultItem('page-2')], total: 22 },
        { page: 2, pageSize: 12 },
      );

    expect(useUserMemoryStore.getState().preferences).toEqual([
      { id: 'existing' },
      { id: 'page-2' },
    ]);
  });
});
