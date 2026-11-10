import { isLocalOrPrivateUrl } from './url';

export interface McpEndpointShape {
  /** MCP transport: `stdio`, `http`, `cloud`, ... (`mcpConnectionType` on connector rows). */
  type?: string | null;
  /** HTTP endpoint (`mcpServerUrl` on connector rows). */
  url?: string | null;
}

/**
 * Whether an MCP endpoint is reachable only from the user's own machine: a
 * stdio server (a local binary) or an HTTP endpoint on localhost / a private
 * network. A cloud server can only call such an endpoint by tunneling to the
 * user's device, so anything that must never touch that device (for example an
 * Agent Share visitor run) has to refuse it.
 */
export const isDeviceOnlyMcpEndpoint = ({ type, url }: McpEndpointShape): boolean =>
  type === 'stdio' || (type !== 'cloud' && !!url && isLocalOrPrivateUrl(url));
