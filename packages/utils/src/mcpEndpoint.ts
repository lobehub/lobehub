import { isLocalOrPrivateUrl } from './url';

/**
 * How an HTTP MCP server is reached, as the user configured it:
 * - `auto` (the default): by address — a localhost / private-network URL is
 *   reached from the user's device, any other from wherever the call runs;
 * - `device`: always from the user's device, for addresses only their machine
 *   resolves or reaches although they look public (Tailscale MagicDNS, `.local`,
 *   intranet DNS, a VPN).
 *
 * Stdio has no choice: it always runs on the user's device.
 */
export type McpConnectVia = 'auto' | 'device';

export interface McpEndpointShape {
  /** `device`: the user chose to reach this HTTP server from their device (`McpConnectVia`). */
  connectVia?: string | null;
  /** MCP transport: `stdio`, `http`, `cloud`, ... (`mcpConnectionType` on connector rows). */
  type?: string | null;
  /** HTTP endpoint (`mcpServerUrl` on connector rows). */
  url?: string | null;
}

/**
 * Whether an MCP endpoint is reachable only from the user's own machine: a
 * stdio server (a local binary), an HTTP server set to connect through the
 * device, or an HTTP endpoint on localhost / a private network. A cloud server
 * can only call such an endpoint by tunneling to the user's device, so anything
 * that must never touch that device (for example an Agent Share visitor run)
 * has to refuse it.
 */
export const isDeviceOnlyMcpEndpoint = ({ connectVia, type, url }: McpEndpointShape): boolean =>
  type === 'stdio' ||
  (type !== 'cloud' && (connectVia === 'device' || (!!url && isLocalOrPrivateUrl(url))));

/**
 * Whether a server must run this MCP endpoint on the user's device instead of
 * connecting to it itself. The single routing rule for every server path (agent
 * tool calls, connector calls, tool-list syncs):
 *
 * - stdio always runs on a device, never in the server process; without a
 *   device gateway the caller fails rather than spawning it;
 * - a device-only HTTP endpoint ({@link isDeviceOnlyMcpEndpoint}) goes through
 *   the device gateway when one is configured. A self-hosted server without a
 *   gateway keeps connecting in-process, since it may share the endpoint's LAN.
 */
export const shouldConnectViaDevice = (
  endpoint: McpEndpointShape,
  { deviceGatewayConfigured }: { deviceGatewayConfigured: boolean },
): boolean =>
  endpoint.type === 'stdio' || (deviceGatewayConfigured && isDeviceOnlyMcpEndpoint(endpoint));

/** The connection a connector row's MCP endpoint is configured with. */
export const connectorMcpEndpoint = (connector: {
  mcpConnectionType?: string | null;
  mcpServerUrl?: string | null;
  metadata?: { connectVia?: unknown } | null;
}): McpEndpointShape => ({
  connectVia: connectorConnectVia(connector.metadata),
  type: connector.mcpConnectionType,
  url: connector.mcpServerUrl,
});

/**
 * A connector's connection choice (`metadata.connectVia`). Only `device` is
 * stored; anything else reads as `auto`.
 */
export const connectorConnectVia = (
  metadata: { connectVia?: unknown } | null | undefined,
): McpConnectVia => (metadata?.connectVia === 'device' ? 'device' : 'auto');

/**
 * The device a device-only MCP server is pinned to. `workspaceId` is the pool
 * the device lives in: a workspace connector binds a device of its workspace,
 * a personal one a device of its owner (no `workspaceId`).
 */
export interface McpDeviceBinding {
  deviceId: string;
  workspaceId?: string;
}

/**
 * The device a connector is bound to (`metadata.boundDeviceId`), or `undefined`
 * when it picks a device automatically. Only a server that runs on the user's
 * device ({@link isDeviceOnlyMcpEndpoint}) can be bound: a binding left on one
 * the server reaches itself is ignored, as the editor hides it there.
 */
export const connectorDeviceBinding = (connector: {
  mcpConnectionType?: string | null;
  mcpServerUrl?: string | null;
  metadata?: { boundDeviceId?: unknown; connectVia?: unknown } | null;
  workspaceId?: string | null;
}): McpDeviceBinding | undefined => {
  const deviceId = connector.metadata?.boundDeviceId;
  if (typeof deviceId !== 'string' || !deviceId) return undefined;
  if (!isDeviceOnlyMcpEndpoint(connectorMcpEndpoint(connector))) return undefined;
  return connector.workspaceId ? { deviceId, workspaceId: connector.workspaceId } : { deviceId };
};
