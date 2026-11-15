import { BRANDING_NAME } from '@lobechat/business-const';
import { type LobeChatDatabase } from '@lobechat/database';
import type { GatewayMcpParams } from '@lobechat/device-gateway-client';
import type { DeviceClient } from '@lobechat/types';
import debug from 'debug';

import type { HttpMCPClientParams, McpTool, StdioMCPParams } from '@/libs/mcp/types';
import { deviceGateway } from '@/server/services/deviceGateway';
import {
  clientKindFromChannels,
  resolveMcpClientKinds,
} from '@/server/services/deviceGateway/deviceChannels';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

const log = debug('lobe-server:mcp:device-tunnel');

/** Code of the error a device-routed MCP fails with when no device can run it. */
export const MCP_DEVICE_UNAVAILABLE = 'MCP_DEVICE_UNAVAILABLE';

/**
 * What a user reads when an MCP server that must run on their device finds no
 * device to run it: why it needs one, and what to do.
 */
export const mcpDeviceUnavailableMessage = (identifier: string) =>
  `MCP server '${identifier}' connects through your own device (it uses stdio, a local-network address, or is set to "Connect via device"), and no online device can run it. Open the ${BRANDING_NAME} desktop app or run \`lh connect\` (update the CLI if it is older) on a computer that can reach this MCP server, then try again.`;

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

/** A device an MCP connection is tunneled to, and which of its clients runs it. */
export interface McpDeviceTarget {
  clientKinds: DeviceClient[];
  deviceId: string;
}

/**
 * The user's most recently active online PERSONAL device that can run an MCP
 * connection: the one a call, a tool listing or a connection test is tunneled
 * to when nothing routed it to a device.
 *
 * Its client is the one `resolveMcpClientKinds` picks: the desktop app, or an
 * `lh connect` that reports MCP support. A device whose clients are unlabelled
 * is skipped: it could be an older CLI that would mis-dispatch the call.
 * Personal scope only: a workspace device may belong to another member, and
 * the connection carries this user's credentials. The scoped helper (not the
 * raw gateway pool) applies device visibility and merges DB state.
 */
export const findPersonalMcpDevice = async (
  serverDB: LobeChatDatabase,
  userId: string,
): Promise<McpDeviceTarget | undefined> => {
  try {
    const devices = await getScopedOnlineDevices(serverDB, userId, undefined);
    // Already sorted online-first / most-recently-active: the newest online
    // device that can run the call wins.
    for (const device of devices) {
      if (!device.online) continue;
      const clientKind = clientKindFromChannels(device.channels);
      if (clientKind === 'unknown') continue;
      const clientKinds = await resolveMcpClientKinds(
        userId,
        device.deviceId,
        undefined,
        clientKind,
      );
      if (clientKinds) return { clientKinds, deviceId: device.deviceId };
    }
    return undefined;
  } catch (error) {
    log('findPersonalMcpDevice: lookup failed for user %s — %O', userId, error);
    return undefined;
  }
};

/**
 * List an MCP server's tools on the user's own device, for a server this
 * deployment must not connect to itself (`shouldConnectViaDevice`): an
 * install, a tool refresh or a connection test the user started. It runs on
 * the device and client a tool call would, so both reach the server alike.
 *
 * Throws {@link McpDeviceUnavailableError} when no device of theirs can run
 * it, and the device's own reason when the listing fails there.
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
    clientKinds: device.clientKinds,
    deviceId: device.deviceId,
    mcpApps,
    params: toGatewayMcpParams(params),
    userId,
  });
};
