/**
 * @vitest-environment happy-dom
 *
 * The GitHub integration reads (config, identity, installations) are a local
 * replica: a reload paints the last connection before the network answers.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppIndexedDBStorage, cacheScope, REPLICA_INDEX_KEY } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { scmService } from '@/services/scm';

import { useGithubIntegration } from './useGithubIntegration';

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
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const CONFIG = { github: { appSlug: 'lobehub', enabled: true, installPath: '/install' } };
const IDENTITY = {
  avatarUrl: null,
  externalLogin: 'octocat',
  externalUserId: '1',
  provider: 'github',
};
const installation = (id: string, accountLogin: string) =>
  ({ accountLogin, id, installationId: id, repositories: [] }) as never;

// Same namespaces the integration replicas persist under (`replica:<name>:v<version>`).
const storages = {
  config: new AppIndexedDBStorage<unknown>({ namespace: 'replica:scmConfig:v1' }),
  identity: new AppIndexedDBStorage<unknown>({ namespace: 'replica:scmIdentity:v1' }),
  installations: new AppIndexedDBStorage<unknown>({ namespace: 'replica:scmInstallations:v1' }),
};

describe('useGithubIntegration local replica', () => {
  let scope = '';

  const persist = async (installations: unknown[]) => {
    const at = { queryKey: 'github', scope };
    await storages.config.set(at, { data: CONFIG, updatedAt: 1 });
    await storages.identity.set(at, { data: { identity: IDENTITY }, updatedAt: 1 });
    await storages.installations.set(at, { data: installations, updatedAt: 1 });
  };

  beforeEach(() => {
    // A fresh random scope per test: memory is dropped like on a cold boot.
    scope = `github-user-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  });

  afterEach(async () => {
    cleanup();
    for (const storage of Object.values(storages)) {
      await storage.remove({ queryKey: 'github', scope });
      await storage.remove({ queryKey: REPLICA_INDEX_KEY, scope });
    }
    vi.restoreAllMocks();
  });

  it('paints the persisted connection before the network answers, then refreshes it', async () => {
    await persist([installation('1', 'stored-org')]);
    const installations = deferred<never[]>();
    vi.spyOn(scmService, 'getConfig').mockResolvedValue(CONFIG as never);
    vi.spyOn(scmService, 'getIdentity').mockResolvedValue(IDENTITY as never);
    vi.spyOn(scmService, 'listInstallations').mockReturnValue(installations.promise as never);

    const { result } = renderHook(() => useGithubIntegration(), { wrapper });

    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.enabled).toBe(true);
    expect(result.current.identity?.externalLogin).toBe('octocat');
    expect(result.current.installations.map((item) => item.accountLogin)).toEqual(['stored-org']);

    await act(async () => installations.resolve([installation('2', 'fresh-org')]));
    await waitFor(() =>
      expect(result.current.installations.map((item) => item.accountLogin)).toEqual(['fresh-org']),
    );
  });

  it('keeps an empty restored copy loading until the server confirms it', async () => {
    await persist([]);
    const installations = deferred<never[]>();
    vi.spyOn(scmService, 'getConfig').mockResolvedValue(CONFIG as never);
    vi.spyOn(scmService, 'getIdentity').mockResolvedValue(IDENTITY as never);
    vi.spyOn(scmService, 'listInstallations').mockReturnValue(installations.promise as never);

    const { result } = renderHook(() => useGithubIntegration(), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.isInitialLoading).toBe(true);

    await act(async () => installations.resolve([]));
    await waitFor(() => expect(result.current.isInitialLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it('shares one request between the overview card and the detail page', async () => {
    vi.spyOn(scmService, 'getConfig').mockResolvedValue(CONFIG as never);
    vi.spyOn(scmService, 'getIdentity').mockResolvedValue(null as never);
    vi.spyOn(scmService, 'listInstallations').mockResolvedValue([] as never);

    const { result } = renderHook(() => [useGithubIntegration(), useGithubIntegration()], {
      wrapper,
    });

    await waitFor(() => expect(result.current[0].isInitialLoading).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(scmService.getConfig).toHaveBeenCalledTimes(1);
    expect(scmService.getIdentity).toHaveBeenCalledTimes(1);
    expect(scmService.listInstallations).toHaveBeenCalledTimes(1);
    expect(result.current[1].identity).toBeNull();
  });
});
