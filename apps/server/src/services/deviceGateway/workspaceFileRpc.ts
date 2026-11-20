import { deviceRpcClients } from '@lobechat/device-control/rpc-clients';
import type { GatewayHttpClient } from '@lobechat/device-gateway-client';

export interface DeviceWorktree {
  approvedRoot: string;
  sourcePath: string;
  worktreePath: string;
}

export const invokeWorkspaceFileRpc = <T>(
  client: GatewayHttpClient,
  address: Parameters<GatewayHttpClient['invokeRpc']>[0],
  rpc: Parameters<GatewayHttpClient['invokeRpc']>[1],
  worktree?: DeviceWorktree,
) =>
  worktree
    ? client.invokeRpc<T>(
        { ...address, clientKinds: deviceRpcClients(rpc.method) },
        { method: 'runWorktreeFileOperation', params: { ...worktree, rpc } },
      )
    : client.invokeRpc<T>(address, rpc);
