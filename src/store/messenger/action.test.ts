/**
 * @vitest-environment happy-dom
 *
 * Messenger writes land on the replica (view + persisted copy), so a reload
 * never brings back a removed connection, and a failed write rolls back.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, REPLICA_INDEX_KEY } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { messengerService } from '@/services/messenger';

import { messengerActions } from './action';
import {
  messengerInstallationsResource,
  messengerLinksResource,
  messengerPlatformsResource,
  messengerPushWindowResource,
} from './projection';
import { messengerSelectors } from './selectors';
import { useMessengerStore } from './store';

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

const link = (id: string, platform: string, tenantId = '') =>
  ({
    activeAgentId: null,
    id,
    platform,
    platformUserId: id,
    platformUsername: id,
    tenantId,
    workspaceId: null,
  }) as never;

const installation = (id: string, platform: string, tenantId: string) =>
  ({ id, platform, tenantId, tenantName: tenantId }) as never;

const linksStorage = messengerLinksResource.storage!;
const installationsStorage = messengerInstallationsResource.storage!;
const ids = (items: { id: string }[] | undefined) => items?.map((item) => item.id);

describe('messengerActions writes', () => {
  let scope = '';

  const stored = async (storage: typeof linksStorage) =>
    (await storage.get({ queryKey: 'all', scope }))?.data as { id: string }[] | undefined;

  /** Mount the lists like the settings page and wait for the server's answer. */
  const mountConnections = async () => {
    renderHook(
      () => {
        messengerActions.useFetchLinks();
        messengerActions.useFetchInstallations();
      },
      { wrapper },
    );
    await waitFor(() => {
      expect(messengerSelectors.links(useMessengerStore.getState())).toBeDefined();
      expect(messengerSelectors.installations(useMessengerStore.getState())).toBeDefined();
    });
    await waitFor(async () => expect(await stored(linksStorage)).toBeDefined());
  };

  beforeEach(() => {
    scope = `messenger-write-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => messengerActions.reset());
  });

  afterEach(async () => {
    cleanup();
    for (const storage of [linksStorage, installationsStorage]) {
      await storage.remove({ queryKey: 'all', scope });
      await storage.remove({ queryKey: REPLICA_INDEX_KEY, scope });
    }
    vi.restoreAllMocks();
  });

  it('removes an unlinked WeChat connection from the view and from storage', async () => {
    vi.spyOn(messengerService, 'listMyLinks').mockResolvedValue([
      link('tg', 'telegram'),
      link('wx', 'wechat', 'wx-tenant'),
    ] as never);
    vi.spyOn(messengerService, 'listMyInstallations').mockResolvedValue([
      installation('wx', 'wechat', 'wx-tenant'),
    ] as never);
    await mountConnections();

    vi.spyOn(messengerService, 'unlink').mockResolvedValue({ success: true } as never);
    // The refresh after the write fails: the removal must not depend on it.
    vi.mocked(messengerService.listMyLinks).mockRejectedValue(new Error('offline'));
    vi.mocked(messengerService.listMyInstallations).mockRejectedValue(new Error('offline'));

    await act(() => messengerActions.unlink({ platform: 'wechat', tenantId: 'wx-tenant' }));

    const state = useMessengerStore.getState();
    expect(ids(messengerSelectors.links(state))).toEqual(['tg']);
    expect(messengerSelectors.installations(state)).toEqual([]);
    // A reload cannot restore it from the local copy.
    await waitFor(async () => expect(ids(await stored(linksStorage))).toEqual(['tg']));
    await waitFor(async () => expect(await stored(installationsStorage)).toEqual([]));
  });

  it('restores the link when unlinking fails', async () => {
    vi.spyOn(messengerService, 'listMyLinks').mockResolvedValue([link('tg', 'telegram')] as never);
    vi.spyOn(messengerService, 'listMyInstallations').mockResolvedValue([] as never);
    await mountConnections();
    vi.spyOn(messengerService, 'unlink').mockRejectedValue(new Error('denied'));

    await act(async () => {
      await expect(messengerActions.unlink({ platform: 'telegram' })).rejects.toThrow('denied');
    });

    expect(ids(messengerSelectors.links(useMessengerStore.getState()))).toEqual(['tg']);
    expect(ids(await stored(linksStorage))).toEqual(['tg']);
  });

  it('removes an uninstalled installation from the view and from storage', async () => {
    vi.spyOn(messengerService, 'listMyLinks').mockResolvedValue([] as never);
    vi.spyOn(messengerService, 'listMyInstallations').mockResolvedValue([
      installation('a', 'slack', 'T1'),
      installation('b', 'slack', 'T2'),
    ] as never);
    await mountConnections();
    vi.spyOn(messengerService, 'uninstallInstallation').mockResolvedValue({} as never);
    vi.mocked(messengerService.listMyInstallations).mockRejectedValue(new Error('offline'));

    await act(() => messengerActions.uninstallInstallation('a'));

    expect(ids(messengerSelectors.installations(useMessengerStore.getState()))).toEqual(['b']);
    await waitFor(async () => expect(ids(await stored(installationsStorage))).toEqual(['b']));
  });

  it('shows a new active agent at once and adopts the server row', async () => {
    vi.spyOn(messengerService, 'listMyLinks').mockResolvedValue([
      link('s1', 'slack', 'T1'),
      link('s2', 'slack', 'T2'),
    ] as never);
    vi.spyOn(messengerService, 'listMyInstallations').mockResolvedValue([] as never);
    await mountConnections();

    let release!: () => void;
    vi.spyOn(messengerService, 'setActiveAgent').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              data: {
                ...(link('s1', 'slack', 'T1') as object),
                activeAgentId: 'agt_1',
                workspaceId: 'ws_1',
              },
              success: true,
            } as never);
        }),
    );

    let pending!: Promise<void>;
    act(() => {
      pending = messengerActions.setActiveAgent({
        agentId: 'agt_1',
        platform: 'slack',
        tenantId: 'T1',
      });
    });

    const optimistic = messengerSelectors.links(useMessengerStore.getState()) as {
      activeAgentId: string | null;
    }[];
    expect(optimistic.map((item) => item.activeAgentId)).toEqual(['agt_1', null]);

    await act(async () => {
      release();
      await pending;
    });
    const confirmed = messengerSelectors.links(useMessengerStore.getState()) as {
      workspaceId: string | null;
    }[];
    expect(confirmed.map((item) => item.workspaceId)).toEqual(['ws_1', null]);
  });

  it('rolls the active agent back when the server rejects it', async () => {
    vi.spyOn(messengerService, 'listMyLinks').mockResolvedValue([link('tg', 'telegram')] as never);
    vi.spyOn(messengerService, 'listMyInstallations').mockResolvedValue([] as never);
    await mountConnections();
    vi.spyOn(messengerService, 'setActiveAgent').mockRejectedValue(new Error('denied'));

    await act(async () => {
      await expect(
        messengerActions.setActiveAgent({ agentId: 'agt_1', platform: 'telegram' }),
      ).rejects.toThrow('denied');
    });

    const links = messengerSelectors.links(useMessengerStore.getState()) as {
      activeAgentId: string | null;
    }[];
    expect(links[0].activeAgentId).toBeNull();
  });
});

describe('messenger read replicas', () => {
  let scope = '';

  beforeEach(() => {
    scope = `messenger-read-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => messengerActions.reset());
  });

  afterEach(async () => {
    cleanup();
    await messengerPlatformsResource.storage!.remove({ queryKey: 'all', scope });
    await messengerPlatformsResource.storage!.remove({ queryKey: REPLICA_INDEX_KEY, scope });
    vi.restoreAllMocks();
  });

  it('paints the persisted platform list before the network answers', async () => {
    await messengerPlatformsResource.storage!.set(
      { queryKey: 'all', scope },
      { data: [{ id: 'telegram', name: 'Telegram' }] as never, updatedAt: 1 },
    );
    vi.spyOn(messengerService, 'availablePlatforms').mockReturnValue(
      new Promise(() => {}) as never,
    );

    renderHook(() => messengerActions.useFetchPlatforms(), { wrapper });

    await waitFor(() =>
      expect(ids(messengerSelectors.platforms(useMessengerStore.getState()))).toEqual(['telegram']),
    );
    expect(messengerSelectors.isPlatformsSettled(useMessengerStore.getState())).toBe(true);
    // Restored, not confirmed: a missing platform is not yet "not configured".
    expect(messengerSelectors.isPlatformsConfirmed(useMessengerStore.getState())).toBe(false);
  });

  it('keeps the live push window in memory only and refreshes it after a send', async () => {
    const params = { platform: 'wechat' as const };
    vi.spyOn(messengerService, 'getMessengerPushWindow')
      .mockResolvedValueOnce({
        deliverability: 'windowed',
        remaining: 3,
        windowOpen: true,
      } as never)
      .mockResolvedValue({ deliverability: 'windowed', remaining: 2, windowOpen: true } as never);
    vi.spyOn(messengerService, 'sendMessengerPush').mockResolvedValue({
      remaining: 2,
      status: 'sent',
    } as never);

    renderHook(() => messengerActions.useFetchPushWindow(params), { wrapper });
    await waitFor(() =>
      expect(messengerSelectors.pushWindow(params)(useMessengerStore.getState())).toBeDefined(),
    );

    await act(() => messengerActions.sendPush({ content: 'hi', platform: 'wechat' }));

    expect(
      (messengerSelectors.pushWindow(params)(useMessengerStore.getState()) as { remaining: number })
        .remaining,
    ).toBe(2);
    expect(messengerPushWindowResource.persistKey('wechat:')).toBe(false);
  });
});
