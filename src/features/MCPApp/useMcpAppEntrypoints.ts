import { getDisabledPluginIds } from '@lobechat/types';
import { useEffect } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { refreshMcpAppDiscovery } from '@/store/mcpApp/discovery';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { getToolStoreState, useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector/selectors';

import { selectMcpAppEntrypoints } from './entrypoints';

/** Refresh legacy cached discovery once per user session, without schema migration. */
export const useMcpAppEntrypoints = (agentId?: string) => {
  const enabled = useServerConfigStore(serverConfigSelectors.enableMcpApps);
  const agentPlugins = useAgentStore((s) =>
    enabled && agentId ? agentSelectors.getAgentConfigById(agentId)(s)?.plugins : undefined,
  );
  const [plugins, connectors, agentConnectors] = useToolStore((s) => [
    s.installedPlugins,
    s.connectors,
    s.agentConnectors,
  ]);
  useEffect(() => {
    if (!enabled) return;
    const state = getToolStoreState();
    if (!pluginSelectors.isInstalledPluginsServerConfirmed(state))
      void state.refreshPlugins().catch(() => {});
    void getToolStoreState()
      .ensureConfirmedConnectors(agentId)
      .catch(() => {});
  }, [enabled, agentId]);
  useEffect(() => {
    if (!enabled) return;
    const state = getToolStoreState();
    for (const row of [...connectors, ...(agentId ? (agentConnectors[agentId] ?? []) : [])]) {
      const connector = connectorSelectors.connectorByIdentifierForAgent(
        row.identifier,
        agentId,
      )(state);
      if (connector?.id !== row.id || !connector.isEnabled) continue;
      if (!(connector.mcpServerUrl || connector.mcpConnectionType === 'stdio')) continue;
      if (
        connector.tools.some((tool) => !Array.isArray(tool.metadata?.entrypoints)) ||
        !connector.tools.length
      )
        refreshMcpAppDiscovery(`connector:${connector.id}`, () =>
          state.syncConnectorTools(connector.id),
        );
    }
    for (const plugin of plugins) {
      const config = plugin.customParams?.mcp;
      if (!config || plugin.manifest?.mcpAppEntrypoints !== undefined) continue;
      refreshMcpAppDiscovery(`plugin:${plugin.identifier}`, async () => {
        const [{ mcpService }, { pluginService }] = await Promise.all([
          import('@/services/mcp'),
          import('@/services/plugin'),
        ]);
        const manifest =
          config.type === 'stdio'
            ? await mcpService.getStdioMcpServerManifest({
                ...config,
                command: config.command!,
                name: plugin.identifier,
              })
            : config.type === 'http' && config.url
              ? await mcpService.getStreamableMcpServerManifest({
                  ...config,
                  identifier: plugin.identifier,
                  url: config.url,
                })
              : undefined;
        if (!manifest) return;
        await pluginService.updatePluginManifest(plugin.identifier, manifest);
        await state.refreshPlugins();
      });
    }
  }, [enabled, plugins, connectors, agentConnectors, agentId]);
  return selectMcpAppEntrypoints(getToolStoreState(), enabled, agentId).filter(
    (entry) => !getDisabledPluginIds(agentPlugins).includes(entry.identifier),
  );
};
