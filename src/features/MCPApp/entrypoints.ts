import { isDesktop } from '@lobechat/const';
import type { McpAppThreadEntry } from '@lobechat/const/mcpApp';

import { isInstalledPluginAvailableInCurrentEnv } from '@/helpers/toolAvailability';
import { connectorSelectors } from '@/store/tool/slices/connector/selectors';
import type { ToolStore } from '@/store/tool/store';

export interface AppEntrypoint extends McpAppThreadEntry {
  identifier: string;
}
export const mcpEntryTabKey = (identifier: string, toolName: string) =>
  `mcp-entry:${encodeURIComponent(identifier)}:${encodeURIComponent(toolName)}`;
/** One entrypoint tab's app instance: per conversation (`scope`) and tab. */
export const mcpEntryInstanceId = (scope: string, tab: string) => `${scope}:${tab}`;
export const parseMcpEntryTab = (tab: string) => {
  if (!tab.startsWith('mcp-entry:')) return;
  const parts = tab.slice(10).split(':');
  if (parts.length !== 2) return;
  try {
    return { identifier: decodeURIComponent(parts[0]), toolName: decodeURIComponent(parts[1]) };
  } catch {
    return;
  }
};

export const selectMcpAppEntrypoints = (
  state: ToolStore,
  enabled: boolean,
  agentId?: string,
): AppEntrypoint[] => {
  if (!enabled) return [];
  const identifiers = new Set([
    ...state.installedPlugins.map((plugin) => plugin.identifier),
    ...state.connectors.map((connector) => connector.identifier),
    ...(agentId ? (state.agentConnectors[agentId] ?? []) : []).map(
      (connector) => connector.identifier,
    ),
  ]);
  return [...identifiers].flatMap((identifier) => {
    const connector = connectorSelectors.connectorByIdentifierForAgent(identifier, agentId)(state);
    if (connector && !connector.isEnabled) return [];
    const isMcp = connector && (connector.mcpServerUrl || connector.mcpConnectionType === 'stdio');
    const plugin = state.installedPlugins.find((item) => item.identifier === identifier);
    // An app only a desktop can run (stdio) is offered there alone: elsewhere opening it always fails
    if (
      isMcp
        ? connector.mcpConnectionType === 'stdio' && !isDesktop
        : plugin && !isInstalledPluginAvailableInCurrentEnv(plugin)
    )
      return [];
    const entries = isMcp
      ? connector.tools.flatMap((tool) => {
          const entry = tool.metadata?.threadEntry as McpAppThreadEntry | undefined;
          return entry ? [entry] : [];
        })
      : (plugin?.manifest?.mcpAppEntrypoints ?? []);
    return entries
      .filter(
        (entry) =>
          connector?.tools.find((tool) => tool.toolName === entry.toolName)?.permission !==
          'disabled',
      )
      .map((entry) => ({ ...entry, identifier }));
  });
};
