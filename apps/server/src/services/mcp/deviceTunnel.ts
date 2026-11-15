import { BRANDING_NAME } from '@lobechat/business-const';
import { type LobeChatDatabase } from '@lobechat/database';
import type { GatewayMcpParams } from '@lobechat/device-gateway-client';
import debug from 'debug';

import type { HttpMCPClientParams, McpTool, StdioMCPParams } from '@/libs/mcp/types';
import { deviceGateway } from '@/server/services/deviceGateway';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

const log = debug('lobe-server:mcp:device-tunnel');

/** Code of the error a device-routed MCP fails with when no device can run it. */
export const MCP_DEVICE_UNAVAILABLE = 'MCP_DEVICE_UNAVAILABLE';

/**
 * What a user reads when an MCP server that must run on their device finds no
 * desktop app to run it: why it needs one, and what to do.
 */
export const mcpDeviceUnavailableMessage = (identifier: string) =>
  `MCP server '${identifier}' connects through your device (it uses stdio, a local-network address, or is set to "Connect via device"), but no online ${BRANDING_NAME} desktop app was found. Open the ${BRANDING_NAME} desktop app on a computer that can reach this MCP server and sign in to this account, then try again. A device connected only through the \`lh connect\` CLI cannot run MCP servers.`;

export class McpDeviceUnavailableError extends Error {
  readonly code = MCP_DEVICE_UNAVAILABLE;

  constructor(identifier: string) {
    super(mcpDeviceUnavailableMessage(identifier));
    this.name = 'McpDeviceUnavailableError';
  }
}

/**
 * The connection params a device needs to reach an MCP server. Credentials for
 * HTTP are narrowed to the token fields: the full `AuthConfig` also carries
 * OAuth client secrets and refresh tokens, which never leave the server.
 */
export const toGatewayMcpParams = (
  params: StdioMCPParams | HttpMCPClientParams,
): GatewayMcpParams =>
  params.type === 'stdio'
    ? {
        args: params.args ?? [],
        command: params.command,
        env: params.env,
        name: params.name,
        type: 'stdio',
      }
    : {
        auth: params.auth
          ? {
              accessToken: params.auth.accessToken,
              token: params.auth.token,
              type: params.auth.type,
            }
          : undefined,
        headers: params.headers,
        name: params.name,
        type: 'http',
        url: params.url,
      };

/**
 * The user's most recently active online PERSONAL desktop device: the one an
 * MCP connection is tunneled to when nothing routed the call to a device.
 *
 * Desktop only: the `lh connect` CLI has no MCP client. Personal scope only: a
 * workspace device may belong to another member, and the connection carries
 * this user's credentials. The scoped helper (not the raw gateway pool)
 * applies device visibility and merges DB state.
 */
export const findPersonalMcpDevice = async (
  serverDB: LobeChatDatabase,
  userId: string,
): Promise<{ deviceId: string } | undefined> => {
  try {
    const devices = await getScopedOnlineDevices(serverDB, userId, undefined);
    // Already sorted online-first / most-recently-active
    const newest = devices.find(
      (d) =>
        d.online && d.channels?.some((c) => c.channel === 'desktop' || c.channel === 'desktop-dev'),
    );
    return newest ? { deviceId: newest.deviceId } : undefined;
  } catch (error) {
    log('findPersonalMcpDevice: lookup failed for user %s — %O', userId, error);
    return undefined;
  }
};

/**
 * List an MCP server's tools on the user's own desktop device, for a server
 * this deployment must not connect to itself (`shouldConnectViaDevice`): an
 * install, a tool refresh or a connection test the user started.
 *
 * Throws {@link McpDeviceUnavailableError} when no desktop app of theirs is
 * online, and the device's own reason when the listing fails there.
 */
export const listMcpToolsOnPersonalDevice = async ({
  mcpApps,
  params,
  serverDB,
  userId,
}: {
  mcpApps?: boolean;
  params: StdioMCPParams | HttpMCPClientParams;
  serverDB?: LobeChatDatabase;
  userId?: string | null;
}): Promise<McpTool[]> => {
  if (!serverDB || !userId) throw new McpDeviceUnavailableError(params.name);

  const device = await findPersonalMcpDevice(serverDB, userId);
  if (!device) throw new McpDeviceUnavailableError(params.name);

  log('listing tools of %s (%s) on device %s', params.name, params.type, device.deviceId);

  return deviceGateway.listMcpTools({
    deviceId: device.deviceId,
    mcpApps,
    params: toGatewayMcpParams(params),
    userId,
  });
};
