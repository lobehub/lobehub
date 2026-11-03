/**
 * @vitest-environment happy-dom
 *
 * The installed-plugins list is a replica: the persisted display projection
 * paints on the first frame and the network confirms the full records. The
 * projection never carries settings or connection parameters, so everything
 * that runs or writes a plugin waits for the server-confirmed records.
 */
import { randomUUID } from 'node:crypto';

import { type LobeTool } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isInstalledPluginAvailableInCurrentEnv } from '@/helpers/toolAvailability';
import { cacheScope, REPLICA_INDEX_KEY } from '@/libs/replica';
import { broadcastCacheScope, resetCacheScopeBroadcast } from '@/libs/replica/cacheScopeEvents';
import { setScopedMutate } from '@/libs/swr/mutate';
import { pluginService } from '@/services/plugin';

import { toolSelectors } from '../../selectors';
import { useToolStore } from '../../store';
import { initialPluginState } from './initialState';
import { installedPluginsResource, toInstalledPluginsProjection } from './projection';
import { pluginSelectors } from './selectors';

vi.mock('@/services/plugin', () => ({
  pluginService: {
    createCustomPlugin: vi.fn(),
    getInstalledPlugins: vi.fn(),
    uninstallPlugin: vi.fn(),
    updatePlugin: vi.fn(),
    updatePluginSettings: vi.fn(),
  },
}));

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

const SECRET = 'sk-live-secret-value';

const plugin = (
  identifier: string,
  settings: Record<string, unknown> = {},
  customParams?: unknown,
): LobeTool =>
  ({
    customParams,
    identifier,
    manifest: { api: [], identifier, meta: { title: identifier } },
    settings,
    type: 'plugin',
  }) as unknown as LobeTool;

/** An MCP plugin whose record carries every kind of credential. */
const mcpPlugin = (identifier: string, type: 'http' | 'stdio' = 'http'): LobeTool =>
  plugin(
    identifier,
    { apiKey: SECRET },
    {
      mcp: {
        args: ['--token', SECRET],
        auth: { accessToken: SECRET, clientSecret: SECRET, token: SECRET, type: 'oauth2' },
        command: 'node',
        env: { TOKEN: SECRET },
        headers: { Authorization: `Bearer ${SECRET}` },
        type,
        url: 'https://mcp.example.com',
      },
    },
  );

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

const STORAGE_KEY = installedPluginsResource.storageKey({});

const ids = () => useToolStore.getState().installedPlugins.map((p) => p.identifier);

describe('installed plugins replica', () => {
  const scopes = new Set<string>();
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };
  const readPersisted = async (at = scope) =>
    (await installedPluginsResource.storage!.get({ queryKey: STORAGE_KEY, scope: at }))?.data;
  const seedPersisted = (data: LobeTool[]) =>
    installedPluginsResource.storage!.set({ queryKey: STORAGE_KEY, scope }, { data, updatedAt: 1 });
  const mountSync = (enabled = true) =>
    renderHook(() => useToolStore((s) => s.useFetchInstalledPlugins)(enabled), { wrapper });

  /**
   * Mount the sync over a persisted copy while the network never answers. The
   * copy is what an earlier session persisted: the display projection.
   */
  const paintFromCache = async (data: LobeTool[]) => {
    await seedPersisted(toInstalledPluginsProjection(data));
    vi.mocked(pluginService.getInstalledPlugins).mockImplementation(pending);
    const sync = mountSync();
    await waitFor(() => expect(ids()).toEqual(data.map((p) => p.identifier)));
    return sync;
  };

  /** Mount the sync and wait for the server's records. */
  const loadFromServer = async (data: LobeTool[]) => {
    vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue(data);
    const sync = mountSync();
    await waitFor(() =>
      expect(useToolStore.getState().installedPluginsReplica.entries.installed?.source).toBe(
        'server',
      ),
    );
    return sync;
  };

  beforeEach(() => {
    resetCacheScopeBroadcast();
    useScope(`plugin-user-${randomUUID()}:personal`);
    act(() => useToolStore.setState(initialPluginState));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) =>
        [STORAGE_KEY, REPLICA_INDEX_KEY].map((queryKey) =>
          installedPluginsResource.storage!.remove({ queryKey, scope: value }),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('hydrate and sync', () => {
    it('paints the persisted list before the network answers', async () => {
      const sync = await paintFromCache([plugin('p1')]);

      expect(useToolStore.getState().isInstalledPluginsInit).toBe(true);
      expect(sync.result.current.isHydrated).toBe(true);
      expect(sync.result.current.isValidating).toBe(true);
      // Display selectors paint the cached row.
      const state = useToolStore.getState();
      expect(pluginSelectors.isPluginInstalled('p1')(state)).toBe(true);
      expect(pluginSelectors.installedPluginMetaList(state).map((p) => p.identifier)).toEqual([
        'p1',
      ]);
      expect(pluginSelectors.getPluginMetaById('p1')(state)).toEqual({ title: 'p1' });
    });

    it('keeps cached rows out of every path that runs or edits a plugin', async () => {
      await paintFromCache([mcpPlugin('mcp-1')]);
      const state = useToolStore.getState();

      expect(pluginSelectors.isInstalledPluginsCacheOnly(state)).toBe(true);
      expect(pluginSelectors.confirmedInstalledPlugins(state)).toEqual([]);
      expect(pluginSelectors.getInstalledPluginById('mcp-1')(state)).toBeUndefined();
      expect(pluginSelectors.getCustomPluginById('mcp-1')(state)).toBeUndefined();
      expect(pluginSelectors.getPluginSettingsById('mcp-1')(state)).toEqual({});
      // Not offered to the model: the cached row has no connection to call.
      expect(pluginSelectors.installedPluginManifestList(state)).toEqual([]);
      expect(toolSelectors.getManifestById('mcp-1')(state)).toBeUndefined();
      expect(
        toolSelectors.availableToolsForDiscovery(state).some((t) => t.identifier === 'mcp-1'),
      ).toBe(false);
      // Nor validated against settings it does not have.
      expect(await useToolStore.getState().validatePluginSettings('mcp-1')).toBeUndefined();
    });

    it('confirms the full records from the server and persists the display projection', async () => {
      await loadFromServer([plugin('p1', { setting1: 'server' })]);
      const state = useToolStore.getState();

      expect(ids()).toEqual(['p1']);
      expect(pluginSelectors.isInstalledPluginsCacheOnly(state)).toBe(false);
      expect(pluginSelectors.getPluginSettingsById('p1')(state)).toEqual({ setting1: 'server' });
      expect(pluginSelectors.installedPluginManifestList(state).map((m) => m.identifier)).toEqual([
        'p1',
      ]);
      await waitFor(async () =>
        expect(await readPersisted()).toEqual([
          { identifier: 'p1', manifest: plugin('p1').manifest, type: 'plugin' },
        ]),
      );
    });

    it('never persists plugin settings or credentials', async () => {
      await loadFromServer([mcpPlugin('mcp-1')]);

      // The in-memory record keeps the full connection…
      expect(useToolStore.getState().installedPlugins[0].customParams?.mcp?.env).toEqual({
        TOKEN: SECRET,
      });

      // …but only the non-secret runtime discriminator reaches storage.
      await waitFor(async () => expect(await readPersisted()).toHaveLength(1));
      const persisted = await readPersisted();
      expect(persisted![0].customParams).toEqual({ mcp: { type: 'http' } });
      expect(persisted![0].settings).toBeUndefined();
      expect(JSON.stringify(persisted)).not.toContain(SECRET);
    });

    it('keeps the discriminators display filters need', async () => {
      await loadFromServer([
        mcpPlugin('mcp-stdio', 'stdio'),
        plugin(
          'composio-1',
          {},
          {
            composio: {
              appSlug: 'gmail',
              authConfigId: 'auth-secret-ref',
              connectedAccountId: 'account-ref',
              status: 'ACTIVE',
            },
          },
        ),
      ]);
      await waitFor(async () => expect(await readPersisted()).toHaveLength(2));
      const [stdio, composio] = (await readPersisted())!;

      // A cached stdio plugin stays off the web before the network answers.
      expect(isInstalledPluginAvailableInCurrentEnv(stdio, { isDesktop: false })).toBe(false);
      expect(isInstalledPluginAvailableInCurrentEnv(stdio, { isDesktop: true })).toBe(true);
      // A cached Composio row stays out of the plugin list.
      expect(composio.customParams).toEqual({ composio: { appSlug: 'gmail', status: 'ACTIVE' } });

      // Reload: the cached list paints with the same filtering as the server one.
      cleanup();
      act(() => useToolStore.setState(initialPluginState));
      await paintFromCache((await readPersisted())!);
      expect(pluginSelectors.installedPluginMetaList(useToolStore.getState())).toEqual([]);
    });

    it('keeps the replica row index as storage keys, never projected', async () => {
      await loadFromServer([plugin('p1')]);

      await waitFor(async () =>
        expect(
          (await installedPluginsResource.storage!.get({ queryKey: REPLICA_INDEX_KEY, scope }))
            ?.data,
        ).toEqual([STORAGE_KEY]),
      );
    });

    it('does not fetch while the sync is disabled', async () => {
      mountSync(false);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(pluginService.getInstalledPlugins).not.toHaveBeenCalled();
      expect(useToolStore.getState().isInstalledPluginsInit).toBe(false);
    });
  });

  describe('scope switch', () => {
    it('drops the previous identity’s plugins before the next one paints', async () => {
      const sync = await loadFromServer([plugin('p1')]);

      vi.mocked(pluginService.getInstalledPlugins).mockImplementation(pending);
      useScope(`plugin-user-${randomUUID()}:personal`);
      sync.rerender();

      await waitFor(() => expect(useToolStore.getState().isInstalledPluginsInit).toBe(false));
      expect(useToolStore.getState().installedPlugins).toEqual([]);
    });

    it('paints the next scope’s own cached list', async () => {
      const sync = await loadFromServer([plugin('personal-plugin')]);

      useScope(`plugin-user-${randomUUID()}:ws-1`);
      await seedPersisted([plugin('workspace-plugin')]);
      vi.mocked(pluginService.getInstalledPlugins).mockImplementation(pending);
      sync.rerender();

      await waitFor(() => expect(ids()).toEqual(['workspace-plugin']));
      // The workspace's cached row is display-only too.
      expect(pluginSelectors.confirmedInstalledPlugins(useToolStore.getState())).toEqual([]);
    });

    it('drops runnable records on a switch even with no sync mounted', async () => {
      await act(async () => {
        vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([mcpPlugin('mcp-1')]);
        await useToolStore.getState().refreshPlugins();
      });
      expect(pluginSelectors.getInstalledPluginById('mcp-1')(useToolStore.getState())).toBeTruthy();

      useScope(`plugin-user-${randomUUID()}:ws-1`);
      act(() => broadcastCacheScope(scope));

      expect(useToolStore.getState().installedPlugins).toEqual([]);
      expect(pluginSelectors.getInstalledPluginById('mcp-1')(useToolStore.getState())).toBe(
        undefined,
      );
    });

    it('drops a refresh that lands after the scope moved on', async () => {
      const response = deferred<LobeTool[]>();
      vi.mocked(pluginService.getInstalledPlugins).mockReturnValue(response.promise);
      const refresh = useToolStore.getState().refreshPlugins();

      useScope(`plugin-user-${randomUUID()}:ws-1`);
      act(() => broadcastCacheScope(scope));
      await act(async () => {
        response.resolve([plugin('personal-plugin')]);
        await refresh;
      });

      expect(useToolStore.getState().installedPlugins).toEqual([]);
      expect(await readPersisted()).toBeUndefined();
    });
  });

  describe('refreshPlugins', () => {
    it('fetches and confirms imperatively when no sync hook is mounted', async () => {
      vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([plugin('p1')]);

      await act(async () => {
        await useToolStore.getState().refreshPlugins();
      });

      expect(pluginService.getInstalledPlugins).toHaveBeenCalledTimes(1);
      expect(ids()).toEqual(['p1']);
      await waitFor(async () => expect(await readPersisted()).toHaveLength(1));
    });

    it('keeps the painted list on screen while the network answers', async () => {
      await loadFromServer([plugin('p1')]);
      vi.mocked(pluginService.getInstalledPlugins).mockImplementation(pending);

      void useToolStore.getState().refreshPlugins();

      expect(ids()).toEqual(['p1']);
    });

    it('never lets an older response overwrite a newer one', async () => {
      const older = deferred<LobeTool[]>();
      const newer = deferred<LobeTool[]>();
      vi.mocked(pluginService.getInstalledPlugins)
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);

      const first = useToolStore.getState().refreshPlugins();
      const second = useToolStore.getState().refreshPlugins();
      await act(async () => {
        newer.resolve([plugin('p1'), plugin('p2')]);
        await second;
        older.resolve([plugin('p1')]);
        await first;
      });

      expect(ids()).toEqual(['p1', 'p2']);
    });
  });

  describe('install / uninstall propagation', () => {
    it('shows a newly installed plugin and persists it', async () => {
      await loadFromServer([plugin('p1')]);
      vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([
        plugin('p1'),
        plugin('custom-1'),
      ]);

      await act(async () => {
        await useToolStore
          .getState()
          .installCustomPlugin({ identifier: 'custom-1', type: 'customPlugin' } as any);
      });

      expect(pluginService.createCustomPlugin).toHaveBeenCalled();
      expect(ids()).toEqual(['p1', 'custom-1']);
      await waitFor(async () =>
        expect((await readPersisted())?.map((p) => p.identifier)).toEqual(['p1', 'custom-1']),
      );
    });

    it('keeps the row until the server confirms the uninstall, then drops it everywhere', async () => {
      await loadFromServer([plugin('p1'), plugin('p2')]);
      await waitFor(async () => expect(await readPersisted()).toHaveLength(2));

      const uninstall = deferred<void>();
      vi.mocked(pluginService.uninstallPlugin).mockReturnValue(uninstall.promise);
      // The follow-up refresh has not caught up yet: the removal must still hold.
      vi.mocked(pluginService.getInstalledPlugins).mockImplementation(pending);

      void useToolStore.getState().uninstallMCPPlugin('p1');
      expect(ids()).toEqual(['p1', 'p2']);

      await act(async () => {
        uninstall.resolve();
        await uninstall.promise;
      });

      await waitFor(() => expect(ids()).toEqual(['p2']));
      await waitFor(async () =>
        expect((await readPersisted())?.map((p) => p.identifier)).toEqual(['p2']),
      );

      // Reload: the uninstalled plugin never paints again.
      cleanup();
      act(() => useToolStore.setState(initialPluginState));
      await paintFromCache((await readPersisted())!);
      expect(ids()).toEqual(['p2']);
    });

    it('never lets a sync that started before an uninstall re-add the plugin', async () => {
      const sync = await loadFromServer([plugin('p1'), plugin('p2')]);
      await waitFor(async () => expect(await readPersisted()).toHaveLength(2));

      // A focus / interval revalidation starts before the uninstall…
      const stale = deferred<LobeTool[]>();
      vi.mocked(pluginService.getInstalledPlugins).mockReturnValue(stale.promise);
      void sync.result.current.revalidate();
      await waitFor(() => expect(pluginService.getInstalledPlugins).toHaveBeenCalledTimes(2));

      // …the uninstall lands, and its follow-up refresh is still in flight…
      vi.mocked(pluginService.uninstallPlugin).mockResolvedValue(undefined);
      vi.mocked(pluginService.getInstalledPlugins).mockImplementation(pending);
      await act(async () => {
        void useToolStore.getState().uninstallPlugin('p1');
        await Promise.resolve();
      });
      await waitFor(() => expect(ids()).toEqual(['p2']));

      // …then the pre-uninstall response settles with the old list.
      await act(async () => {
        stale.resolve([plugin('p1'), plugin('p2')]);
        await stale.promise;
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(ids()).toEqual(['p2']);
      await waitFor(async () =>
        expect((await readPersisted())?.map((p) => p.identifier)).toEqual(['p2']),
      );
    });

    it('never lets a sync response overwrite a newer refresh', async () => {
      const sync = await loadFromServer([plugin('p1')]);

      const stale = deferred<LobeTool[]>();
      vi.mocked(pluginService.getInstalledPlugins).mockReturnValueOnce(stale.promise);
      void sync.result.current.revalidate();
      await waitFor(() => expect(pluginService.getInstalledPlugins).toHaveBeenCalledTimes(2));

      vi.mocked(pluginService.getInstalledPlugins).mockResolvedValueOnce([
        plugin('p1'),
        plugin('p2'),
      ]);
      await act(async () => {
        await useToolStore.getState().refreshPlugins();
      });
      expect(ids()).toEqual(['p1', 'p2']);

      await act(async () => {
        stale.resolve([plugin('p1')]);
        await stale.promise;
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(ids()).toEqual(['p1', 'p2']);
    });

    it('routes a custom-plugin uninstall through the same removal', async () => {
      await loadFromServer([plugin('custom-1')]);
      vi.mocked(pluginService.uninstallPlugin).mockResolvedValue(undefined);
      vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([]);

      await act(async () => {
        await useToolStore.getState().uninstallCustomPlugin('custom-1');
      });

      expect(pluginService.uninstallPlugin).toHaveBeenCalledWith('custom-1');
      expect(ids()).toEqual([]);
      await waitFor(async () => expect(await readPersisted()).toEqual([]));
    });

    it('keeps the plugin when the server rejects the uninstall', async () => {
      await loadFromServer([plugin('p1')]);
      vi.mocked(pluginService.uninstallPlugin).mockRejectedValue(new Error('boom'));

      await expect(useToolStore.getState().uninstallPlugin('p1')).rejects.toThrow('boom');

      expect(ids()).toEqual(['p1']);
    });
  });

  describe('settings writes', () => {
    it('shows new settings optimistically, then confirms from the server', async () => {
      await loadFromServer([plugin('p1', { setting1: 'old', setting2: 'keep' })]);

      const write = deferred<void>();
      vi.mocked(pluginService.updatePluginSettings).mockReturnValue(write.promise as any);

      const operation = useToolStore.getState().updatePluginSettings('p1', { setting1: 'new' });
      // Visible before the server answers, merged over the other fields.
      expect(pluginSelectors.getPluginSettingsById('p1')(useToolStore.getState())).toEqual({
        setting1: 'new',
        setting2: 'keep',
      });

      vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([
        plugin('p1', { setting1: 'new', setting2: 'keep' }),
      ]);
      await act(async () => {
        write.resolve();
        await operation;
      });

      expect(pluginService.updatePluginSettings).toHaveBeenCalledWith(
        'p1',
        { setting1: 'new', setting2: 'keep' },
        expect.any(AbortSignal),
      );
      expect(useToolStore.getState().installedPlugins[0].settings).toEqual({
        setting1: 'new',
        setting2: 'keep',
      });
    });

    it('rolls the settings back when the server rejects the write', async () => {
      await loadFromServer([plugin('p1', { setting1: 'old' })]);
      vi.mocked(pluginService.updatePluginSettings).mockRejectedValue(new Error('boom'));

      await expect(
        useToolStore.getState().updatePluginSettings('p1', { setting1: 'new' }),
      ).rejects.toThrow('boom');

      expect(useToolStore.getState().installedPlugins[0].settings).toEqual({ setting1: 'old' });
    });

    it('merges a write from the cached list onto the server record, not the projection', async () => {
      await paintFromCache([plugin('p1', { setting1: 'old', setting2: 'keep' })]);
      // The cached row has no settings: they never reached IndexedDB.
      expect(useToolStore.getState().installedPlugins[0].settings).toBeUndefined();

      vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([
        plugin('p1', { setting1: 'old', setting2: 'keep' }),
      ]);
      vi.mocked(pluginService.updatePluginSettings).mockResolvedValue(undefined as any);

      await act(async () => {
        await useToolStore.getState().updatePluginSettings('p1', { setting1: 'new' });
      });

      expect(pluginService.updatePluginSettings).toHaveBeenCalledWith(
        'p1',
        { setting1: 'new', setting2: 'keep' },
        expect.any(AbortSignal),
      );
    });

    it('writes nothing when the server record cannot be loaded', async () => {
      await paintFromCache([plugin('p1')]);
      vi.mocked(pluginService.getInstalledPlugins).mockRejectedValue(new Error('offline'));

      await expect(
        useToolStore.getState().updatePluginSettings('p1', { setting1: 'new' }),
      ).rejects.toThrow('offline');

      expect(pluginService.updatePluginSettings).not.toHaveBeenCalled();
    });

    it('lets a newer write abort one still waiting for the server record', async () => {
      await paintFromCache([plugin('p1', { a: 1 })]);
      const records = deferred<LobeTool[]>();
      vi.mocked(pluginService.getInstalledPlugins).mockReturnValue(records.promise);
      vi.mocked(pluginService.updatePluginSettings).mockResolvedValue(undefined as any);

      const first = useToolStore.getState().updatePluginSettings('p1', { a: 2 });
      const firstSignal = useToolStore.getState().updatePluginSettingsSignal!;
      const second = useToolStore.getState().updatePluginSettings('p1', { a: 3 });

      // The first controller was published before the await, so the second aborts it.
      expect(firstSignal.signal.aborted).toBe(true);

      await act(async () => {
        records.resolve([plugin('p1', { a: 1, b: 'keep' })]);
        await Promise.all([first, second]);
      });

      expect(pluginService.updatePluginSettings).toHaveBeenCalledTimes(1);
      expect(pluginService.updatePluginSettings).toHaveBeenCalledWith(
        'p1',
        { a: 3, b: 'keep' },
        expect.any(AbortSignal),
      );
    });

    it('keeps the connection parameters the projection hid when writing an MCP delta', async () => {
      const full = mcpPlugin('mcp-1');
      await paintFromCache([full]);
      expect(useToolStore.getState().installedPlugins[0].customParams).toEqual({
        mcp: { type: 'http' },
      });

      vi.mocked(pluginService.getInstalledPlugins).mockResolvedValue([full]);
      vi.mocked(pluginService.updatePlugin).mockResolvedValue(undefined as any);

      await act(async () => {
        await useToolStore.getState().updateInstallMcpPlugin('mcp-1', { env: { EXTRA: '1' } });
      });

      expect(pluginService.updatePlugin).toHaveBeenCalledWith('mcp-1', {
        customParams: {
          mcp: expect.objectContaining({
            env: { EXTRA: '1', TOKEN: SECRET },
            headers: { Authorization: `Bearer ${SECRET}` },
            type: 'http',
            url: 'https://mcp.example.com',
          }),
        },
      });
    });
  });
});
