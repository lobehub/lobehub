import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FilesLocation } from '../useRememberedFilesLocation';

const scope = vi.hoisted(() => ({ current: 'u1:personal' }));
const trusted = vi.hoisted(() => ({ current: true }));

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => scope.current,
  isScopeTrusted: () => trusted.current,
  useCacheScope: () => scope.current,
  useIsScopeTrusted: () => trusted.current,
}));

interface Props {
  contextKey?: string;
  resolved?: FilesLocation;
  settled: boolean;
}

/** A fresh page (new store and replica engine) over the same localStorage. */
const boot = async (initialProps: Props) => {
  vi.resetModules();
  const { useRememberedFilesLocation } = await import('../useRememberedFilesLocation');
  return renderHook(
    ({ contextKey, resolved, settled }: Props) =>
      useRememberedFilesLocation(contextKey, resolved, settled),
    { initialProps },
  );
};

/** One session that settles on `location` for `contextKey`. */
const storedRows = () =>
  Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).filter(
    (key) => key.startsWith('replica:filesLocation:') && !key.includes('__replica'),
  );

const remember = async (contextKey: string, location: FilesLocation) => {
  const view = await boot({ contextKey, resolved: location, settled: true });
  await waitFor(() => expect(storedRows().length).toBeGreaterThan(0));
  view.unmount();
};

beforeEach(() => {
  scope.current = 'u1:personal';
  trusted.current = true;
  localStorage.clear();
});

describe('useRememberedFilesLocation', { timeout: 15_000 }, () => {
  it('opens where the conversation last was until the device list settles', async () => {
    await remember('topic/t1', { deviceId: 'device-1', directory: '/repo' });

    // Before the device default is known the live resolution is the home fallback.
    const { rerender, result } = await boot({
      contextKey: 'topic/t1',
      resolved: { deviceId: 'device-1', directory: '/Users/me' },
      settled: false,
    });
    await waitFor(() =>
      expect(result.current).toEqual({ deviceId: 'device-1', directory: '/repo' }),
    );

    rerender({
      contextKey: 'topic/t1',
      resolved: { deviceId: 'device-1', directory: '/repo/next' },
      settled: true,
    });
    expect(result.current).toEqual({ deviceId: 'device-1', directory: '/repo/next' });

    // The next session opens the new location.
    const next = await boot({
      contextKey: 'topic/t1',
      resolved: { deviceId: 'device-1', directory: '/Users/me' },
      settled: false,
    });
    await waitFor(() =>
      expect(next.result.current).toEqual({ deviceId: 'device-1', directory: '/repo/next' }),
    );
  });

  it('rejects a saved location from a different host before the device list settles', async () => {
    await remember('topic/t1', { deviceId: 'device-old', directory: '/old-repo' });

    // The agent's target changed: the live host is already known from config.
    const { result } = await boot({
      contextKey: 'topic/t1',
      resolved: { deviceId: 'device-new', directory: '/new-repo' },
      settled: false,
    });

    await waitFor(() =>
      expect(result.current).toEqual({ deviceId: 'device-new', directory: '/new-repo' }),
    );
  });

  it('does not use a remembered filesystem location when nothing can read it', async () => {
    await remember('topic/t1', { directory: '/repo' });

    // A sandbox / cloud-only target: no filesystem environment, so the old
    // local path must not enable Files or route mutations through IPC.
    const { result } = await boot({
      contextKey: undefined,
      resolved: undefined,
      settled: false,
    });

    expect(result.current).toBeUndefined();
  });

  it('answers with the saved location on the first render, before the replica hydrates', async () => {
    await remember('topic/t1', { directory: '/repo' });

    const { result } = await boot({
      contextKey: 'topic/t1',
      resolved: { directory: '/Users/me' },
      settled: false,
    });

    expect(result.current).toEqual({ directory: '/repo' });
  });

  it('uses the live resolution when nothing was remembered for this context', async () => {
    await remember('topic/other', { directory: '/elsewhere' });

    const { result } = await boot({
      contextKey: 'topic/t1',
      resolved: { directory: '/repo' },
      settled: false,
    });

    await waitFor(() => expect(result.current).toEqual({ directory: '/repo' }));
  });

  it('keeps each identity’s locations apart', async () => {
    await remember('topic/t1', { directory: '/repo' });

    scope.current = 'u2:personal';
    const { result } = await boot({
      contextKey: 'topic/t1',
      resolved: { directory: '/Users/other' },
      settled: false,
    });

    await waitFor(() => expect(result.current).toEqual({ directory: '/Users/other' }));
  });

  it('does not remember an unsettled resolution', async () => {
    const view = await boot({
      contextKey: 'topic/t1',
      resolved: { directory: '/Users/me' },
      settled: false,
    });
    await waitFor(() => expect(view.result.current).toEqual({ directory: '/Users/me' }));

    expect(storedRows()).toEqual([]);
  });

  it('keeps its replica keys out of the SWR persistent cache', async () => {
    const { replicaKeys } = await import('@lobechat/replica');
    const { unstable_serialize } = await import('swr');
    const { CACHE_TIERS } = await import('@/libs/swr/localStorageProvider');
    const { filesLocationResource } = await import('@/store/projectFile/projection');
    const { filesLocationContextKey } = await import('../useRememberedFilesLocation');
    const patterns = [...CACHE_TIERS.idb, ...CACHE_TIERS.local];

    for (const contextKey of [
      filesLocationContextKey('tpc_1', 'agt_1')!,
      filesLocationContextKey(undefined, 'agt_1')!,
    ]) {
      const { name, version } = filesLocationResource;
      const storageKey = filesLocationResource.storageKey({ contextKey });
      // The SWR provider persists any key containing a tier pattern, so the
      // replica's hydrate read must not carry one.
      const swrKey = unstable_serialize(
        replicaKeys.hydrate(name, version, 'u1:personal', storageKey),
      );
      expect(patterns.filter((pattern) => swrKey.includes(pattern))).toEqual([]);
    }
  });

  it('passes the resolution through when there is no context to remember', async () => {
    const { result } = await boot({ resolved: { directory: '' }, settled: false });

    expect(result.current).toEqual({ directory: '' });
  });

  it('writes the location again once identity resolves', async () => {
    trusted.current = false;
    const view = await boot({
      contextKey: 'topic/t1',
      resolved: { directory: '/repo' },
      settled: true,
    });
    // The engine drops the write while the scope is untrusted, even though the
    // value is already in memory.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(storedRows()).toHaveLength(0);

    trusted.current = true;
    view.rerender({ contextKey: 'topic/t1', resolved: { directory: '/repo' }, settled: true });
    await waitFor(() => expect(storedRows().length).toBeGreaterThan(0));
  });
});
