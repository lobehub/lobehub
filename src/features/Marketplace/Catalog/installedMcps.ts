import type { ToolStoreState } from '@/store/tool/initialState';
import { pluginSelectors } from '@/store/tool/selectors';
import { connectorSelectors } from '@/store/tool/slices/connector';

import { buildInstalledDetailPath } from '../paths';

export const getInstalledMcpItems = (state: ToolStoreState) => {
  const legacy = pluginSelectors
    .installedPluginMetaList(state)
    .filter((plugin) => plugin.type === 'plugin' || plugin.type === 'customPlugin')
    .map((plugin) => ({
      avatar: plugin.avatar,
      description: plugin.description || plugin.author,
      identifier: plugin.identifier,
      key: `plugin:${plugin.identifier}`,
      path: buildInstalledDetailPath(
        'mcp',
        plugin.identifier,
        plugin.type === 'customPlugin' ? 'mcp-connector' : 'plugin',
      ),
      private: false,
      title: plugin.title || plugin.identifier,
    }));
  const connectors = connectorSelectors.userMcpConnectors(state).map((connector) => ({
    avatar: typeof connector.metadata?.avatar === 'string' ? connector.metadata.avatar : undefined,
    description:
      typeof connector.metadata?.description === 'string'
        ? connector.metadata.description
        : undefined,
    identifier: connector.identifier,
    key: `connector:${connector.id}`,
    path: buildInstalledDetailPath(
      'mcp',
      connector.identifier,
      'mcp-connector',
      connector.visibility,
    ),
    private: connector.visibility === 'private',
    title: connector.name || connector.identifier,
  }));
  return [...legacy, ...connectors];
};
