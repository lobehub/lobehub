import { builtinTools } from '@lobechat/builtin-tools';
import { type ConnectorCatalogItem, getConnectorCatalog } from '@lobechat/const';
import type { AvailablePluginInfo, OfficialToolItem } from '@lobechat/context-engine';

import type { ContextFactRequest } from './types';

const connectorIdentifier = (item: ConnectorCatalogItem) =>
  item.type === 'lobehub' ? item.provider.id : item.serverType.identifier;

/**
 * Tools that only make sense for the agent they ship with; never offered as
 * something to create a new agent with.
 */
const INTERNAL_TOOLS = new Set([
  'lobe-agent-management',
  'lobe-agent-builder',
  'lobe-group-agent-builder',
  'lobe-page-agent',
]);

/**
 * The official tool catalog as the agent / group builder prompt lists it:
 * every visible builtin (connectors rendered through their canonical owner),
 * then every connector this deployment offers with its connection status.
 */
export const listOfficialTools = (params: {
  connectedConnectorIds: Set<string>;
  enabledPlugins: string[];
  features: ContextFactRequest['features'];
}): OfficialToolItem[] => {
  const { connectedConnectorIds, enabledPlugins, features } = params;
  const catalog = getConnectorCatalog({
    composio: features.composio,
    lobehub: features.lobehubSkill,
  });
  const connectorIdentifiers = new Set(catalog.map(connectorIdentifier));
  const officialTools: OfficialToolItem[] = [];

  for (const tool of builtinTools) {
    if (tool.hidden) continue;
    if (connectorIdentifiers.has(tool.identifier)) continue;
    officialTools.push({
      description: tool.manifest?.meta?.description,
      enabled: enabledPlugins.includes(tool.identifier),
      identifier: tool.identifier,
      installed: true,
      name: tool.manifest?.meta?.title || tool.identifier,
      type: 'builtin',
    });
  }

  for (const item of catalog) {
    if (item.type === 'composio') {
      officialTools.push({
        description: `LobeHub Mcp Server: ${item.serverType.label}`,
        enabled: enabledPlugins.includes(item.serverType.identifier),
        identifier: item.serverType.identifier,
        installed: connectedConnectorIds.has(item.serverType.identifier),
        name: item.serverType.label,
        type: 'composio',
      });
      continue;
    }
    officialTools.push({
      description: `LobeHub Skill Provider: ${item.provider.label}`,
      enabled: enabledPlugins.includes(item.provider.id),
      identifier: item.provider.id,
      installed: connectedConnectorIds.has(item.provider.id),
      name: item.provider.label,
      type: 'lobehub-skill',
    });
  }

  return officialTools;
};

/**
 * Plugins the agent-management tool may attach to a new agent: every builtin
 * except the internal ones (hidden builtins included — web browsing and the
 * sandbox are real capabilities), plus the connector catalog.
 */
export const listAvailablePlugins = (
  features: ContextFactRequest['features'],
): AvailablePluginInfo[] => {
  const catalog = getConnectorCatalog({
    composio: features.composio,
    lobehub: features.lobehubSkill,
  });
  const connectorIdentifiers = new Set(catalog.map(connectorIdentifier));
  const plugins: AvailablePluginInfo[] = [];

  for (const tool of builtinTools) {
    if (connectorIdentifiers.has(tool.identifier) || INTERNAL_TOOLS.has(tool.identifier)) continue;
    plugins.push({
      description: tool.manifest?.meta?.description,
      identifier: tool.identifier,
      name: tool.manifest?.meta?.title || tool.identifier,
      type: 'builtin',
    });
  }

  for (const item of catalog) {
    if (item.type === 'composio') {
      plugins.push({
        description: item.serverType.description,
        identifier: item.serverType.identifier,
        name: item.serverType.label,
        type: 'composio',
      });
      continue;
    }
    plugins.push({
      description: item.provider.description,
      identifier: item.provider.id,
      name: item.provider.label,
      type: 'lobehub-skill',
    });
  }

  return plugins;
};
