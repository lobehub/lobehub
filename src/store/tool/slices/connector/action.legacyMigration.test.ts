import type { LobeToolCustomPlugin } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { useToolStore } from '../../store';
import { initialConnectorState } from './initialState';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: {
      create: { mutate: vi.fn() },
      delete: { mutate: vi.fn() },
      list: { query: vi.fn() },
      listAgentBound: { query: vi.fn() },
      syncTools: { mutate: vi.fn() },
      syncToolsFromClientById: { mutate: vi.fn() },
    },
    market: {
      getMcpManifest: { query: vi.fn(async () => ({ tools: [{ name: 'search' }] })) },
    },
    plugin: {
      getPlugins: { query: vi.fn() },
      removePlugin: { mutate: vi.fn() },
    },
  },
}));

const legacy = {
  customParams: { mcp: { type: 'http', url: 'https://example.com/mcp' } },
  identifier: 'legacy',
  type: 'customPlugin',
} satisfies LobeToolCustomPlugin;

describe('legacy MCP migration with the connector and plugin stores', () => {
  const { connector, plugin } = lambdaClient;

  beforeEach(() => {
    useToolStore.setState({
      ...initialConnectorState,
      installedPlugins: [legacy],
      isAgentBoundInit: true,
      isConnectorsInit: true,
      isInstalledPluginsInit: true,
    });
    vi.mocked(connector.create.mutate).mockResolvedValue({ id: 'created', isNew: true });
    vi.mocked(connector.list.query).mockResolvedValue([]);
    vi.mocked(connector.listAgentBound.query).mockResolvedValue([]);
    vi.mocked(plugin.getPlugins.query).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it('finishes the save and removes the legacy plugin while list reads are pending', async () => {
    const refresh = Promise.withResolvers<[]>();
    vi.mocked(connector.list.query).mockReturnValue(refresh.promise);
    vi.mocked(connector.listAgentBound.query).mockReturnValue(refresh.promise);
    vi.mocked(plugin.getPlugins.query).mockReturnValue(refresh.promise);
    const completed = vi.fn();
    const save = useToolStore.getState().migrateLegacyPlugin(legacy, legacy).then(completed);
    try {
      await vi.waitFor(() =>
        expect(completed).toHaveBeenCalledWith({ connectorId: 'created', ok: true }),
      );
      expect(plugin.removePlugin.mutate).toHaveBeenCalledWith({ id: 'legacy' });
      expect(useToolStore.getState().installedPlugins).toEqual([]);
      expect(connector.syncTools.mutate).toHaveBeenCalledWith({ id: 'created' });
      expect(connector.list.query).toHaveBeenCalledTimes(1);
      expect(connector.listAgentBound.query).toHaveBeenCalledTimes(1);
      expect(plugin.getPlugins.query).toHaveBeenCalledTimes(1);
    } finally {
      refresh.resolve([]);
      await save;
    }
  });

  it('keeps a synced connector when the list refresh fails', async () => {
    const readError = new Error('list read failed');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(connector.list.query).mockRejectedValue(readError);
    await expect(
      useToolStore.getState().migrateLegacyPlugin(legacy, legacy),
    ).resolves.toMatchObject({ ok: true });
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith('[connector-migration] refreshing lists failed', readError),
    );
    expect(connector.delete.mutate).not.toHaveBeenCalled();
    expect(plugin.removePlugin.mutate).toHaveBeenCalledWith({ id: 'legacy' });
  });

  it('syncs a cloud manifest from the saved transport before the connector is in the list', async () => {
    const cloud = {
      ...legacy,
      customParams: { mcp: { type: 'cloud', url: 'https://example.com/mcp' } },
    } satisfies LobeToolCustomPlugin;
    await useToolStore.getState().migrateLegacyPlugin(cloud, cloud);
    expect(connector.syncToolsFromClientById.mutate).toHaveBeenCalledWith({
      id: 'created',
      tools: [expect.objectContaining({ toolName: 'search' })],
    });
    expect(connector.syncTools.mutate).not.toHaveBeenCalled();
    expect(plugin.removePlugin.mutate).toHaveBeenCalledWith({ id: 'legacy' });
  });

  it.each([true, false])(
    'uses the server upsert result on sync failure (isNew=%s)',
    async (isNew) => {
      vi.mocked(connector.create.mutate).mockResolvedValue({ id: 'target', isNew });
      vi.mocked(connector.syncTools.mutate).mockRejectedValue(new Error('endpoint unreachable'));
      await expect(useToolStore.getState().migrateLegacyPlugin(legacy, legacy)).rejects.toThrow(
        'endpoint unreachable',
      );
      if (isNew) expect(connector.delete.mutate).toHaveBeenCalledWith({ id: 'target' });
      else expect(connector.delete.mutate).not.toHaveBeenCalled();
      expect(plugin.removePlugin.mutate).not.toHaveBeenCalled();
    },
  );
});
