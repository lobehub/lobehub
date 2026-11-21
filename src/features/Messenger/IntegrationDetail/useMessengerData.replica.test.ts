/**
 * @vitest-environment happy-dom
 *
 * The messenger connection lists (links + installations) are a local replica:
 * a reload paints the last local copy before the network answers, then the
 * background revalidation replaces it.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppIndexedDBStorage, cacheScope, REPLICA_INDEX_KEY } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { messengerService } from '@/services/messenger';

import { useMessengerData } from './shared';

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

const link = (id: string, platform = 'telegram') =>
  ({
    activeAgentId: null,
    id,
    platform,
    platformUserId: `user-${id}`,
    platformUsername: id,
    tenantId: '',
    workspaceId: null,
  }) as never;

const installation = (id: string, platform: string, runtime?: unknown) =>
  ({
    applicationId: 'app',
    enterpriseId: null,
    id,
    installedAt: new Date(0),
    isEnterpriseInstall: false,
    platform,
    runtime,
    scope: '',
    tenantId: `tenant-${id}`,
    tenantName: `Tenant ${id}`,
  }) as never;

// Same namespaces the messenger replicas persist under (`replica:<name>:v<version>`).
const linksStorage = new AppIndexedDBStorage<unknown>({ namespace: 'replica:messengerLinks:v1' });
const installationsStorage = new AppIndexedDBStorage<unknown>({
  namespace: 'replica:messengerInstallations:v1',
});

describe('useMessengerData local replica', () => {
  let scope = '';

  const persist = async (links: unknown[], installations: unknown[], at = scope) => {
    await linksStorage.set({ queryKey: 'all', scope: at }, { data: links, updatedAt: 1 });
    await installationsStorage.set(
      { queryKey: 'all', scope: at },
      { data: installations, updatedAt: 1 },
    );
  };

  // Every test runs in a fresh random scope, so memory from an earlier test is
  // dropped like on a cold boot; only storage carries over.
  beforeEach(() => {
    scope = `messenger-user-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    cleanup();
    for (const storage of [linksStorage, installationsStorage]) {
      await storage.remove({ queryKey: 'all', scope });
      await storage.remove({ queryKey: REPLICA_INDEX_KEY, scope });
    }
    vi.restoreAllMocks();
  });

  it('paints the persisted connection before the network answers, then refreshes it', async () => {
    await persist([link('stored')], []);
    const links = deferred<never[]>();
    vi.spyOn(messengerService, 'listMyLinks').mockReturnValue(links.promise as never);
    vi.spyOn(messengerService, 'listMyInstallations').mockResolvedValue([] as never);

    const { result } = renderHook(() => useMessengerData('telegram'), { wrapper });

    // The detail has the last connection on the first painted frame after reload.
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.links.map((item: { id: string }) => item.id)).toEqual(['stored']);

    await act(async () => links.resolve([link('fresh')]));
    await waitFor(() =>
      expect(result.current.links.map((item: { id: string }) => item.id)).toEqual(['fresh']),
    );
  });

  it('treats a restored copy without this platform as loading until the server answers', async () => {
    await persist([], []);
    const links = deferred<never[]>();
    vi.spyOn(messengerService, 'listMyLinks').mockReturnValue(links.promise as never);
    vi.spyOn(messengerService, 'listMyInstallations').mockResolvedValue([] as never);

    const { result } = renderHook(() => useMessengerData('telegram'), { wrapper });

    // Storage answered with an empty list: still not "not connected".
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.isInitialLoading).toBe(true);

    await act(async () => links.resolve([]));
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.links).toEqual([]);
  });

  it('keeps the last connection when the background refresh fails', async () => {
    await persist([link('stored')], []);
    vi.spyOn(messengerService, 'listMyLinks').mockRejectedValue(new Error('offline'));
    vi.spyOn(messengerService, 'listMyInstallations').mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useMessengerData('telegram'), { wrapper });

    await waitFor(() => expect(messengerService.listMyLinks).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.isInitialLoading).toBe(false);
    expect(result.current.links.map((item: { id: string }) => item.id)).toEqual(['stored']);
  });

  it('never shows the previous identity connections after a scope switch', async () => {
    const other = `messenger-other-${randomUUID()}:personal`;
    await persist([link('mine')], []);
    await persist([link('theirs')], [], other);
    vi.spyOn(messengerService, 'listMyLinks').mockReturnValue(new Promise(() => {}) as never);
    vi.spyOn(messengerService, 'listMyInstallations').mockReturnValue(
      new Promise(() => {}) as never,
    );

    const { result, rerender } = renderHook(() => useMessengerData('telegram'), { wrapper });
    await waitFor(() =>
      expect(result.current.links.map((item: { id: string }) => item.id)).toEqual(['mine']),
    );

    scope = other;
    rerender();
    await waitFor(() =>
      expect(result.current.links.map((item: { id: string }) => item.id)).toEqual(['theirs']),
    );

    for (const storage of [linksStorage, installationsStorage]) {
      await storage.remove({ queryKey: 'all', scope: other });
      await storage.remove({ queryKey: REPLICA_INDEX_KEY, scope: other });
    }
  });

  it('issues one request for every detail section reading the lists', async () => {
    vi.spyOn(messengerService, 'listMyLinks').mockResolvedValue([link('a')] as never);
    vi.spyOn(messengerService, 'listMyInstallations').mockResolvedValue([] as never);

    const { result } = renderHook(
      () => [useMessengerData('telegram'), useMessengerData('slack'), useMessengerData('wechat')],
      { wrapper },
    );

    await waitFor(() => expect(result.current[0].isInitialLoading).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(messengerService.listMyLinks).toHaveBeenCalledTimes(1);
    expect(messengerService.listMyInstallations).toHaveBeenCalledTimes(1);
  });

  it('does not persist the live WeChat runtime status', async () => {
    vi.spyOn(messengerService, 'listMyLinks').mockResolvedValue([link('w', 'wechat')] as never);
    vi.spyOn(messengerService, 'listMyInstallations').mockResolvedValue([
      installation('w', 'wechat', { errorCode: 'session_expired', status: 'failed' }),
    ] as never);

    const { result } = renderHook(() => useMessengerData('wechat'), { wrapper });

    // On screen the server's live status is shown…
    await waitFor(() =>
      expect(
        (result.current.installations[0] as { runtime?: { status: string } })?.runtime?.status,
      ).toBe('failed'),
    );
    // …but a reload cannot replay it: the stored row has no runtime.
    await waitFor(async () => {
      const stored = (await installationsStorage.get({ queryKey: 'all', scope }))?.data as
        { id: string; runtime?: unknown }[] | undefined;
      expect(stored?.map((item) => item.id)).toEqual(['w']);
      expect(stored?.[0]?.runtime).toBeUndefined();
    });
  });
});
