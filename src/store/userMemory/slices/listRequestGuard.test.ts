import { beforeEach, describe, expect, it } from 'vitest';

import { useUserMemoryStore } from '@/store/userMemory';
import { initialState } from '@/store/userMemory/initialState';

interface GuardCase {
  accept: (request: { page: number; pageSize: number; q?: string }) => void;
  fail: (error: Error, request: { page: number; pageSize: number; q?: string }) => void;
  name: string;
  readList: () => unknown[];
  readSearchError: () => unknown;
  readSearchLoading: () => boolean | undefined;
  resetWithSearch: () => void;
  seedPageTwo: () => void;
  seedSettledSearch: () => void;
}

const cases: GuardCase[] = [
  {
    accept: (request) =>
      useUserMemoryStore
        .getState()
        .internal_acceptActivitiesList(
          { items: [], page: request.page, pageSize: request.pageSize, total: 22 },
          request,
        ),
    fail: (error, request) =>
      useUserMemoryStore.getState().internal_failActivitiesList(error, request),
    name: 'activities',
    readList: () => useUserMemoryStore.getState().activities,
    readSearchError: () => useUserMemoryStore.getState().activitiesSearchError,
    readSearchLoading: () => useUserMemoryStore.getState().activitiesSearchLoading,
    resetWithSearch: () => useUserMemoryStore.getState().resetActivitiesList({ q: 'late night' }),
    seedSettledSearch: () =>
      useUserMemoryStore.setState({
        activities: [{ id: 'existing' } as never],
        activitiesInit: true,
        activitiesQuery: 'late night',
      }),
    seedPageTwo: () =>
      useUserMemoryStore.setState({ activities: [{ id: 'existing' } as never], activitiesPage: 2 }),
  },
  {
    accept: (request) =>
      useUserMemoryStore.getState().internal_acceptContextsList({ items: [], total: 22 }, request),
    fail: (error, request) =>
      useUserMemoryStore.getState().internal_failContextsList(error, request),
    name: 'contexts',
    readList: () => useUserMemoryStore.getState().contexts,
    readSearchError: () => useUserMemoryStore.getState().contextsSearchError,
    readSearchLoading: () => useUserMemoryStore.getState().contextsSearchLoading,
    resetWithSearch: () => useUserMemoryStore.getState().resetContextsList({ q: 'late night' }),
    seedSettledSearch: () =>
      useUserMemoryStore.setState({
        contexts: [{ id: 'existing' } as never],
        contextsInit: true,
        contextsQuery: 'late night',
      }),
    seedPageTwo: () =>
      useUserMemoryStore.setState({ contexts: [{ id: 'existing' } as never], contextsPage: 2 }),
  },
  {
    accept: (request) =>
      useUserMemoryStore
        .getState()
        .internal_acceptExperiencesList(
          { items: [], page: request.page, pageSize: request.pageSize, total: 22 },
          request,
        ),
    fail: (error, request) =>
      useUserMemoryStore.getState().internal_failExperiencesList(error, request),
    name: 'experiences',
    readList: () => useUserMemoryStore.getState().experiences,
    readSearchError: () => useUserMemoryStore.getState().experiencesSearchError,
    readSearchLoading: () => useUserMemoryStore.getState().experiencesSearchLoading,
    resetWithSearch: () => useUserMemoryStore.getState().resetExperiencesList({ q: 'late night' }),
    seedSettledSearch: () =>
      useUserMemoryStore.setState({
        experiences: [{ id: 'existing' } as never],
        experiencesInit: true,
        experiencesQuery: 'late night',
      }),
    seedPageTwo: () =>
      useUserMemoryStore.setState({
        experiences: [{ id: 'existing' } as never],
        experiencesPage: 2,
      }),
  },
  {
    accept: (request) =>
      useUserMemoryStore
        .getState()
        .internal_acceptPreferencesList({ items: [], total: 22 }, request),
    fail: (error, request) =>
      useUserMemoryStore.getState().internal_failPreferencesList(error, request),
    name: 'preferences',
    readList: () => useUserMemoryStore.getState().preferences,
    readSearchError: () => useUserMemoryStore.getState().preferencesSearchError,
    readSearchLoading: () => useUserMemoryStore.getState().preferencesSearchLoading,
    resetWithSearch: () => useUserMemoryStore.getState().resetPreferencesList({ q: 'late night' }),
    seedSettledSearch: () =>
      useUserMemoryStore.setState({
        preferences: [{ id: 'existing' } as never],
        preferencesInit: true,
        preferencesQuery: 'late night',
      }),
    seedPageTwo: () =>
      useUserMemoryStore.setState({
        preferences: [{ id: 'existing' } as never],
        preferencesPage: 2,
      }),
  },
];

beforeEach(() => {
  useUserMemoryStore.setState(initialState, false);
});

describe('memory list request guards', () => {
  it.each(cases)('ignores a late $name response after a search reset', (testCase) => {
    testCase.seedPageTwo();
    testCase.resetWithSearch();
    testCase.accept({ page: 2, pageSize: 12 });

    expect(testCase.readList()).toEqual([]);
    expect(testCase.readSearchLoading()).toBe(true);
  });

  it.each(cases)('keeps $name loading when an obsolete request fails', (testCase) => {
    testCase.seedPageTwo();
    testCase.resetWithSearch();
    testCase.fail(new Error('request failed'), { page: 2, pageSize: 12 });

    expect(testCase.readSearchError()).toBeUndefined();
    expect(testCase.readSearchLoading()).toBe(true);
  });

  it.each(cases)('preserves the current $name search error after loading settles', (testCase) => {
    testCase.resetWithSearch();
    const error = new Error('request failed');
    testCase.fail(error, { page: 1, pageSize: 12, q: 'late night' });

    expect(testCase.readSearchError()).toBe(error);
    expect(testCase.readSearchLoading()).toBe(false);
  });

  it.each(cases)('preserves settled $name content when a background refresh fails', (testCase) => {
    testCase.seedSettledSearch();
    testCase.fail(new Error('request failed'), { page: 1, pageSize: 12, q: 'late night' });

    expect(testCase.readList()).toHaveLength(1);
    expect(testCase.readSearchError()).toBeUndefined();
  });
});
