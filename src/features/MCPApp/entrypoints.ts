import { isDesktop } from '@lobechat/const';
import type { McpAppThreadEntry } from '@lobechat/const/mcpApp';
import { connectorToolIdentifier } from '@lobechat/types';
import {
  connectorMcpEndpoint,
  type McpEndpointShape,
  shouldConnectViaDevice,
} from '@lobechat/utils/mcpEndpoint';

import { isInstalledPluginAvailableInCurrentEnv } from '@/helpers/toolAvailability';
import type { RunConnectorRow } from '@/services/runConnectors';
import { getServerConfigStoreState } from '@/store/serverConfig/store';
import { connectorSelectors } from '@/store/tool/slices/connector/selectors';
import type { ToolStore } from '@/store/tool/store';

export interface AppEntrypoint extends McpAppThreadEntry {
  /** Name of the account it opens as, on a connector holding several. */
  accountName?: string;
  /** The connector it belongs to, as the agent's configuration names it. */
  connectorIdentifier?: string;
  /** Its tool's identifier: the connector row's tool prefix. */
  identifier: string;
  /**
   * The account it opens as, on a connector holding several: an entrypoint's
   * call carries no arguments to select one, so each account is its own entry.
   */
  linkId?: string;
}
export const mcpEntryTabKey = (identifier: string, toolName: string, linkId?: string) =>
  `mcp-entry:${encodeURIComponent(identifier)}:${encodeURIComponent(toolName)}${
    linkId ? `:${encodeURIComponent(linkId)}` : ''
  }`;
/** One entrypoint tab's app instance: per conversation (`scope`) and tab. */
export const mcpEntryInstanceId = (scope: string, tab: string) => `${scope}:${tab}`;
export const parseMcpEntryTab = (
  tab: string,
): { identifier: string; linkId?: string; toolName: string } | undefined => {
  if (!tab.startsWith('mcp-entry:')) return;
  const parts = tab.slice(10).split(':');
  if (parts.length !== 2 && parts.length !== 3) return;
  try {
    const [identifier, toolName, linkId] = parts.map(decodeURIComponent);
    return { identifier, toolName, ...(linkId && { linkId }) };
  } catch {
    return;
  }
};
/** The entry a tab opens: the same tool, and the same account on a connector holding several. */
export const isEntryOfTab = (
  entry: AppEntrypoint,
  tab: { identifier: string; linkId?: string; toolName: string } | undefined,
) =>
  !!tab &&
  entry.identifier === tab.identifier &&
  entry.toolName === tab.toolName &&
  entry.linkId === tab.linkId;

/**
 * Whether an app's MCP server opens only in the desktop app: elsewhere the
 * server must run it on the user's device (stdio, a localhost / LAN address,
 * or set to connect through the device — `shouldConnectViaDevice`), and an
 * app view's calls are not tunneled there, so opening it always fails.
 */
const opensOnlyOnDesktop = (endpoint: McpEndpointShape) =>
  !isDesktop &&
  shouldConnectViaDevice(endpoint, {
    deviceGatewayConfigured: !!getServerConfigStoreState()?.serverConfig.deviceGatewayConfigured,
  });

export const selectMcpAppEntrypoints = (
  state: ToolStore,
  enabled: boolean,
  agentId?: string,
  /**
   * The rows the server listed for the conversation (`connector.listForRun`),
   * each under its authoritative tool prefix. They are the conversation's
   * connectors when present: only they hold the owner's personal rows a
   * private agent's own topic runs.
   */
  runRows?: RunConnectorRow[],
): AppEntrypoint[] => {
  if (!enabled) return [];
  // Each row under its tool prefix, as the server names it: a private row is
  // its own app beside the shared one of its connector, and a row mounted on
  // the agent keeps its own prefix (only an agent-owned row is bare)
  const reserved = new Set(state.connectors.map((c) => c.identifier));
  const prefixOf = (connector: (typeof state.connectors)[number]) =>
    connectorToolIdentifier(connector, undefined, reserved);
  const identifiers = new Set([
    ...state.installedPlugins.map((plugin) => plugin.identifier),
    ...(runRows
      ? runRows.map((row) => row.toolIdentifier)
      : [
          ...state.connectors.map(prefixOf),
          ...(agentId ? (state.agentConnectors[agentId] ?? []) : []).map(prefixOf),
        ]),
  ]);
  // A listed row the local lists also hold reads their copy's tools: a
  // discovery sync updates those after the listing, so its entries show
  const localRows = new Map(
    [...state.connectors, ...(agentId ? (state.agentConnectors[agentId] ?? []) : [])].map(
      (row) => [row.id, row] as const,
    ),
  );
  const connectorOf = (identifier: string) => {
    if (!runRows)
      return connectorSelectors.connectorByIdentifierForAgent(identifier, agentId)(state);
    const row = runRows.find((listed) => listed.toolIdentifier === identifier);
    const local = row && localRows.get(row.id);
    return row && local ? { ...row, isEnabled: local.isEnabled, tools: local.tools } : row;
  };
  return [...identifiers].flatMap((identifier) => {
    const connector = connectorOf(identifier);
    if (connector && !connector.isEnabled) return [];
    const isMcp = connector && (connector.mcpServerUrl || connector.mcpConnectionType === 'stdio');
    const plugin = state.installedPlugins.find((item) => item.identifier === identifier);
    // An app only a desktop can open is offered there alone: elsewhere opening it always fails
    if (
      isMcp
        ? opensOnlyOnDesktop(connectorMcpEndpoint(connector))
        : plugin &&
          (!isInstalledPluginAvailableInCurrentEnv(plugin) ||
            (!!plugin.customParams?.mcp && opensOnlyOnDesktop(plugin.customParams.mcp)))
    )
      return [];
    const entries = isMcp
      ? connector.tools.flatMap((tool) => {
          const entry = tool.metadata?.threadEntry as McpAppThreadEntry | undefined;
          return entry ? [entry] : [];
        })
      : (plugin?.manifest?.mcpAppEntrypoints ?? []);
    // One entry per account when the connector holds several: its call can't select one
    const accounts = isMcp && (connector.links?.length ?? 0) > 1 ? connector.links! : undefined;
    return entries
      .filter(
        (entry) =>
          connector?.tools.find((tool) => tool.toolName === entry.toolName)?.permission !==
          'disabled',
      )
      .flatMap((entry): AppEntrypoint[] =>
        accounts
          ? accounts.map((account) => ({
              ...entry,
              accountName: account.name,
              connectorIdentifier: connector?.identifier ?? identifier,
              identifier,
              linkId: account.id,
            }))
          : [{ ...entry, connectorIdentifier: connector?.identifier ?? identifier, identifier }],
      );
  });
};
