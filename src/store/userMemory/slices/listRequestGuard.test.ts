import useSWR from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserMemoryStore } from '@/store/userMemory';
import { initialState } from '@/store/userMemory/initialState';

vi.mock('swr', () => ({ default: vi.fn(() => ({})) }));

interface GuardCase {
  fetchCurrent: () => unknown;
  fetchPageTwo: () => unknown;
  name: string;
  readList: () => unknown[];
  readSearchLoading: () => boolean | undefined;
  resetWithSearch: () => void;
  seedPageTwo: () => void;
}

const cases: GuardCase[] = [
  {
    fetchCurrent: () =>
      useUserMemoryStore.getState().useFetchActivities({ page: 1, pageSize: 12, q: 'late night' }),
    fetchPageTwo: () => useUserMemoryStore.getState().useFetchActivities({ page: 2, pageSize: 12 }),
    name: 'activities',
    readList: () => useUserMemoryStore.getState().activities,
    readSearchLoading: () => useUserMemoryStore.getState().activitiesSearchLoading,
    resetWithSearch: () => useUserMemoryStore.getState().resetActivitiesList({ q: 'late night' }),
    seedPageTwo: () =>
      useUserMemoryStore.setState({ activities: [{ id: 'existing' } as never], activitiesPage: 2 }),
  },
  {
    fetchCurrent: () =>
      useUserMemoryStore.getState().useFetchContexts({ page: 1, pageSize: 12, q: 'late night' }),
    fetchPageTwo: () => useUserMemoryStore.getState().useFetchContexts({ page: 2, pageSize: 12 }),
    name: 'contexts',
    readList: () => useUserMemoryStore.getState().contexts,
    readSearchLoading: () => useUserMemoryStore.getState().contextsSearchLoading,
    resetWithSearch: () => useUserMemoryStore.getState().resetContextsList({ q: 'late night' }),
    seedPageTwo: () =>
      useUserMemoryStore.setState({ contexts: [{ id: 'existing' } as never], contextsPage: 2 }),
  },
  {
    fetchCurrent: () =>
      useUserMemoryStore.getState().useFetchExperiences({ page: 1, pageSize: 12, q: 'late night' }),
    fetchPageTwo: () =>
      useUserMemoryStore.getState().useFetchExperiences({ page: 2, pageSize: 12 }),
    name: 'experiences',
    readList: () => useUserMemoryStore.getState().experiences,
    readSearchLoading: () => useUserMemoryStore.getState().experiencesSearchLoading,
    resetWithSearch: () => useUserMemoryStore.getState().resetExperiencesList({ q: 'late night' }),
    seedPageTwo: () =>
      useUserMemoryStore.setState({
        experiences: [{ id: 'existing' } as never],
        experiencesPage: 2,
      }),
  },
  {
    fetchCurrent: () =>
      useUserMemoryStore.getState().useFetchPreferences({ page: 1, pageSize: 12, q: 'late night' }),
    fetchPageTwo: () =>
      useUserMemoryStore.getState().useFetchPreferences({ page: 2, pageSize: 12 }),
    name: 'preferences',
    readList: () => useUserMemoryStore.getState().preferences,
    readSearchLoading: () => useUserMemoryStore.getState().preferencesSearchLoading,
    resetWithSearch: () => useUserMemoryStore.getState().resetPreferencesList({ q: 'late night' }),
    seedPageTwo: () =>
      useUserMemoryStore.setState({
        preferences: [{ id: 'existing' } as never],
        preferencesPage: 2,
      }),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  useUserMemoryStore.setState(initialState, false);
});

describe('memory list request guards', () => {
  it.each(cases)('ignores a late $name response after a search reset', (testCase) => {
    testCase.seedPageTwo();
    testCase.fetchPageTwo();

    testCase.resetWithSearch();
    const onSuccess = vi.mocked(useSWR).mock.calls[0][2]?.onSuccess as (data: {
      items: unknown[];
      total: number;
    }) => void;
    onSuccess({ items: [], total: 22 });

    expect(testCase.readList()).toEqual([]);
    expect(testCase.readSearchLoading()).toBe(true);
  });

  it.each(cases)('keeps $name loading when an obsolete request fails', (testCase) => {
    testCase.seedPageTwo();
    testCase.fetchPageTwo();

    testCase.resetWithSearch();
    const onError = vi.mocked(useSWR).mock.calls[0][2]?.onError as (error: Error) => void;
    onError(new Error('request failed'));

    expect(testCase.readSearchLoading()).toBe(true);
  });

  it.each(cases)('clears $name loading when the current request fails', (testCase) => {
    testCase.resetWithSearch();
    testCase.fetchCurrent();

    const onError = vi.mocked(useSWR).mock.calls[0][2]?.onError as (error: Error) => void;
    onError(new Error('request failed'));

    expect(testCase.readSearchLoading()).toBe(false);
  });
});
