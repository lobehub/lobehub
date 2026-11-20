import { deviceRpcClients } from '@lobechat/device-control/rpc-clients';
import type { GatewayDispatchTarget } from '@lobechat/device-gateway-client';
import { deviceToolClients } from '@lobechat/mecha';
import type { DeviceClient } from '@lobechat/types';

const DESKTOP_ONLY: DeviceClient[] = ['desktop'];

/**
 * Which device clients can serve a gateway request, read from where each
 * capability is declared rather than listed here:
 *
 * - builtin device tools → the manifest's `deviceClients`
 * - MCP calls → the client `resolveMcpClientKinds` picked for the device,
 *   passed explicitly by the tunnel. Desktop only when a caller passes none:
 *   that is the one client known to run them without reading the device's
 *   system info (an older `lh connect` dispatches them by `apiName`)
 * - message API → desktop only (only the desktop app implements a messenger)
 * - RPC → `deviceRpcClients` in `@lobechat/device-control`
 *
 * Sent to the gateway as `clientKinds` so a device holding both the desktop
 * app and `lh connect` routes each call to a client that can run it.
 */
export const resolveDeviceClientKinds = (
  target: GatewayDispatchTarget,
): DeviceClient[] | undefined => {
  switch (target.kind) {
    case 'tool': {
      return target.type === 'mcp' ? DESKTOP_ONLY : deviceToolClients(target.identifier);
    }
    case 'messageApi': {
      return DESKTOP_ONLY;
    }
    case 'rpc': {
      return deviceRpcClients(target.method);
    }
  }
};
