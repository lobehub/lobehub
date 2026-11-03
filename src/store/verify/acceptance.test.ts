import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, createReplicaState } from '@/libs/replica';
import { verifyService } from '@/services/verify';

import { useVerifyStore } from './index';

vi.mock('@/services/verify', () => ({
  verifyService: {
    getAcceptanceBundle: vi.fn(),
    getAcceptanceBySubject: vi.fn(),
  },
}));

// The replica drives its fetches through the app SWR hook; mocking it lets a
// test hand the engine a server response without a network round trip.
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useVerifyStore.setState({
    acceptanceBundleMap: {},
    acceptanceBundleReplica: createReplicaState(),
    acceptanceBySubjectMap: {},
    acceptanceBySubjectReplica: createReplicaState(),
  });
});

/** The `replica:sync` query a resource registered with the SWR driver. */
const syncCalls = async (name: 'acceptanceBundle' | 'acceptanceBySubject') => {
  const { useClientDataSWR } = await import('@/libs/swr');
  return vi
    .mocked(useClientDataSWR)
    .mock.calls.filter(
      ([key]) => Array.isArray(key) && key[0] === 'replica:sync' && key[1] === name,
    )
    .map(([key, _fetcher, config]) => ({
      config: config as { onSuccess?: (data: unknown) => void },
      key: key as unknown[],
    }));
};

/** The matcher functions passed to the scoped SWR `mutate` by a revalidate. */
const revalidateMatchers = async () => {
  const { mutate } = await import('@/libs/swr');
  return vi
    .mocked(mutate)
    .mock.calls.map(([arg]) => arg)
    .filter((arg): arg is (key: unknown) => boolean => typeof arg === 'function');
};

describe('verify acceptance replica', () => {
  it('reports an acceptance bundle under the replica sync key of its id', async () => {
    renderHook(() => useVerifyStore.getState().useFetchAcceptanceBundle('acceptance-1'));

    const calls = await syncCalls('acceptanceBundle');
    expect(calls).toHaveLength(1);
    expect(calls[0].key[4]).toBe('acceptance-1');
  });

  it('paints a fetched bundle into the replica view', async () => {
    vi.mocked(verifyService.getAcceptanceBundle).mockResolvedValue({
      acceptance: { id: 'acceptance-1' },
      checks: [],
    } as never);

    renderHook(() => useVerifyStore.getState().useFetchAcceptanceBundle('acceptance-1'));
    const [call] = await syncCalls('acceptanceBundle');

    await act(async () => {
      call.config.onSuccess?.({ acceptance: { id: 'acceptance-1' }, checks: [] });
    });

    expect(useVerifyStore.getState().acceptanceBundleMap['acceptance-1']).toMatchObject({
      acceptance: { id: 'acceptance-1' },
      checks: [],
    });
  });

  it('keys a subject attachment as `<subjectType>:<subjectId>`', async () => {
    vi.mocked(verifyService.getAcceptanceBySubject).mockResolvedValue({
      id: 'acceptance-1',
      status: 'verifying',
    } as never);

    renderHook(() => useVerifyStore.getState().useFetchAcceptanceBySubject('task', 'task-1'));
    const [call] = await syncCalls('acceptanceBySubject');

    expect(call.key[4]).toBe('task:task-1');

    await act(async () => {
      call.config.onSuccess?.({ id: 'acceptance-1', status: 'verifying' });
    });

    expect(useVerifyStore.getState().acceptanceBySubjectMap['task:task-1']).toMatchObject({
      id: 'acceptance-1',
      status: 'verifying',
    });
  });

  it('keeps a subject without an acceptance empty so the poll can discover it', async () => {
    vi.mocked(verifyService.getAcceptanceBySubject).mockResolvedValue(null);

    renderHook(() => useVerifyStore.getState().useFetchAcceptanceBySubject('task', 'task-2'));
    const [call] = await syncCalls('acceptanceBySubject');

    await act(async () => {
      call.config.onSuccess?.(null);
    });

    expect(useVerifyStore.getState().acceptanceBySubjectMap['task:task-2']).toBeUndefined();
  });

  it('clears a subject attachment the server no longer has', async () => {
    renderHook(() => useVerifyStore.getState().useFetchAcceptanceBySubject('task', 'task-3'));
    const [call] = await syncCalls('acceptanceBySubject');

    // The subject starts with an aggregate, as an earlier poll / hydrate left it.
    await act(async () => {
      call.config.onSuccess?.({ id: 'acceptance-1', status: 'verifying' });
    });
    expect(useVerifyStore.getState().acceptanceBySubjectMap['task:task-3']).toMatchObject({
      id: 'acceptance-1',
      status: 'verifying',
    });

    // A later poll reports none (the acceptance was deleted): the previous
    // aggregate must be removed, not retained by the merge fallback.
    await act(async () => {
      call.config.onSuccess?.(null);
    });
    expect(useVerifyStore.getState().acceptanceBySubjectMap['task:task-3']).toBeUndefined();
  });

  it('revalidates only the refreshed acceptance bundle', async () => {
    await useVerifyStore.getState().refreshAcceptanceBundle('acceptance-1');

    const matchers = await revalidateMatchers();
    const matches = (key: unknown[]) => matchers.some((matcher) => matcher(key));
    const scope = cacheScope.get();

    expect(
      matches(['replica:sync', 'acceptanceBundle', 1, scope, 'acceptance-1', 'acceptance-1']),
    ).toBe(true);
    expect(
      matches(['replica:sync', 'acceptanceBundle', 1, scope, 'acceptance-2', 'acceptance-2']),
    ).toBe(false);
  });

  it('revalidates only the refreshed subject attachment', async () => {
    await useVerifyStore.getState().refreshAcceptanceBySubject('task', 'task-1');

    const matchers = await revalidateMatchers();
    const matches = (key: unknown[]) => matchers.some((matcher) => matcher(key));
    const scope = cacheScope.get();

    expect(
      matches([
        'replica:sync',
        'acceptanceBySubject',
        1,
        scope,
        'task:task-1',
        { subjectId: 'task-1', subjectType: 'task' },
      ]),
    ).toBe(true);
    expect(
      matches([
        'replica:sync',
        'acceptanceBySubject',
        1,
        scope,
        'task:task-2',
        { subjectId: 'task-2', subjectType: 'task' },
      ]),
    ).toBe(false);
  });
});
