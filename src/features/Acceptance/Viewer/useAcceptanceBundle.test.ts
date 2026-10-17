/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';

import { AcceptanceInitialBundle } from './AcceptanceInitialBundle';
import { useAcceptanceBundle } from './useAcceptanceBundle';

const swr = vi.hoisted(() => {
  const revalidate = vi.fn(async () => undefined);
  const state: { error: unknown } = { error: undefined };
  return {
    revalidate,
    state,
    useClientDataSWR: vi.fn(() => ({
      error: state.error,
      isValidating: false,
      mutate: revalidate,
    })),
  };
});

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: swr.useClientDataSWR,
}));
vi.mock('@/services/verify', () => ({ verifyService: { getAcceptanceBundle: vi.fn() } }));

// Imported after the mocks so the store binds the mocked driver.
const { useVerifyStore } = await import('@/store/verify');

const seedBundle = (id: string, bundle: unknown) =>
  useVerifyStore.setState({ acceptanceBundleMap: { [id]: bundle as never } });

/** The config the bundle's `replica:sync` query was registered with. */
const bundleSyncConfig = async () => {
  const { useClientDataSWR } = await import('@/libs/swr');
  const call = vi
    .mocked(useClientDataSWR)
    .mock.calls.find(
      ([key]) => Array.isArray(key) && key[0] === 'replica:sync' && key[1] === 'acceptanceBundle',
    );
  return call?.[2] as { refreshInterval?: number } | undefined;
};

beforeEach(() => {
  vi.clearAllMocks();
  swr.state.error = undefined;
  useVerifyStore.setState({
    acceptanceBundleMap: {},
    acceptanceBundleReplica: createReplicaState(),
    acceptanceBySubjectMap: {},
    acceptanceBySubjectReplica: createReplicaState(),
  });
});

it('reads the bundle straight from the replica view', () => {
  seedBundle('acceptance-1', { acceptance: { status: 'verifying' } });

  const { result } = renderHook(() => useAcceptanceBundle('acceptance-1'));

  expect(result.current.data).toMatchObject({ acceptance: { status: 'verifying' } });
});

it('polls a still-moving acceptance every 5s', async () => {
  seedBundle('acceptance-1', { acceptance: { status: 'verifying' } });

  renderHook(() => useAcceptanceBundle('acceptance-1'));

  expect((await bundleSyncConfig())?.refreshInterval).toBe(5000);
});

it.each(['accepted', 'closed'])('stops polling a settled (%s) acceptance', async (status) => {
  seedBundle('acceptance-1', { acceptance: { status } });

  renderHook(() => useAcceptanceBundle('acceptance-1'));

  expect((await bundleSyncConfig())?.refreshInterval).toBe(0);
});

it('never polls a detail-only reader, even while the round is live', async () => {
  seedBundle('acceptance-1', { acceptance: { status: 'verifying' } });

  renderHook(() => useAcceptanceBundle('acceptance-1', { poll: false }));

  expect((await bundleSyncConfig())?.refreshInterval).toBe(0);
});

it('registers no sync query without an acceptance id', async () => {
  renderHook(() => useAcceptanceBundle(null));

  expect(await bundleSyncConfig()).toBeUndefined();
});

it('never reports loading without an acceptance id', () => {
  const { result } = renderHook(() => useAcceptanceBundle(null));

  expect(result.current.isLoading).toBe(false);
});

/** Wraps a hook in the request-local initial bundle the Workbench loader provides. */
const initialBundleWrapper = (acceptanceId: string, bundle: unknown) =>
  function Wrapper({ children }: PropsWithChildren) {
    return createElement(
      AcceptanceInitialBundle,
      { acceptanceId, bundle: bundle as never },
      children,
    );
  };

it('paints the loader-provided initial bundle on the first render', () => {
  const bundle = { acceptance: { status: 'verifying' } };
  const { result } = renderHook(() => useAcceptanceBundle('acceptance-1'), {
    wrapper: initialBundleWrapper('acceptance-1', bundle),
  });

  // The gate must paint the authorized bundle instead of a spinner: the
  // Workbench runtime never hydrates the persisted replica, so without this the
  // server and the first client render would have no data at all.
  expect(result.current.data).toBe(bundle);
  expect(result.current.isLoading).toBe(false);
});

it('ignores an initial bundle that belongs to another acceptance id', () => {
  const { result } = renderHook(() => useAcceptanceBundle('acceptance-2'), {
    wrapper: initialBundleWrapper('acceptance-1', { acceptance: { status: 'verifying' } }),
  });

  expect(result.current.data).toBeUndefined();
});

it('stops exposing the initial bundle once the server answers a terminal error', () => {
  const bundle = { acceptance: { status: 'verifying' } };
  const { result, rerender } = renderHook(() => useAcceptanceBundle('acceptance-1'), {
    wrapper: initialBundleWrapper('acceptance-1', bundle),
  });
  expect(result.current.data).toBe(bundle);

  // Deleted / access revoked after the loader succeeded: the replica entry is
  // dropped, and the immutable seed must not be re-exposed behind it — the gate
  // would otherwise keep painting (and polling) a bundle the server no longer
  // serves instead of its terminal state.
  swr.state.error = { data: { code: 'NOT_FOUND' } };
  rerender();

  expect(result.current.data).toBeUndefined();
});

it('prefers the live replica over the initial bundle', () => {
  seedBundle('acceptance-1', { acceptance: { status: 'accepted' } });

  const { result } = renderHook(() => useAcceptanceBundle('acceptance-1'), {
    wrapper: initialBundleWrapper('acceptance-1', { acceptance: { status: 'verifying' } }),
  });

  expect(result.current.data).toMatchObject({ acceptance: { status: 'accepted' } });
});

it('mutate revalidates this acceptance and resolves the freshly read value', async () => {
  seedBundle('acceptance-1', { acceptance: { status: 'verifying' } });
  const { result } = renderHook(() => useAcceptanceBundle('acceptance-1'));

  const syncKey = vi
    .mocked(swr.useClientDataSWR)
    .mock.calls.map(([key]) => key)
    .find(
      (key) => Array.isArray(key) && key[0] === 'replica:sync' && key[1] === 'acceptanceBundle',
    ) as unknown[];

  await act(async () => {
    await result.current.mutate();
  });

  // The hook's mutate revalidates the entry through its own SWR key.
  expect(swr.revalidate).toHaveBeenCalled();
  expect(syncKey[4]).toBe('acceptance-1');

  await expect(result.current.mutate()).resolves.toMatchObject({
    acceptance: { status: 'verifying' },
  });
});

/** The `onError` handler the bundle's sync query was registered with. */
const bundleSyncOnError = async () => {
  const config = (await bundleSyncConfig()) as { onError?: (error: unknown) => void } | undefined;
  return config?.onError;
};

it('drops a cached bundle when revalidation reports it is gone', async () => {
  seedBundle('acceptance-1', { acceptance: { status: 'verifying' } });

  renderHook(() => useAcceptanceBundle('acceptance-1'));

  const onError = await bundleSyncOnError();
  await act(async () => {
    onError?.({ data: { code: 'NOT_FOUND' } });
  });

  // The gate must be able to show the terminal state, not a stale decision
  // surface kept alive by the persisted projection.
  expect(useVerifyStore.getState().acceptanceBundleMap['acceptance-1']).toBeUndefined();
});

it('keeps a cached bundle on a retryable revalidation failure', async () => {
  seedBundle('acceptance-1', { acceptance: { status: 'verifying' } });

  renderHook(() => useAcceptanceBundle('acceptance-1'));

  const onError = await bundleSyncOnError();
  await act(async () => {
    onError?.(new Error('offline'));
  });

  expect(useVerifyStore.getState().acceptanceBundleMap['acceptance-1']).toBeDefined();
});
