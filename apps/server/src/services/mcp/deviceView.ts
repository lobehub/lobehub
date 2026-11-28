import { getMcpServerFingerprint, type McpServerAddress } from '@lobechat/const/mcpApp';

import type { HttpMCPClientParams, StdioMCPParams } from '@/libs/mcp/types';

/**
 * The MCP server some connection params reach, as an MCP App view names it
 * (`getMcpServerFingerprint`): a stdio server by its command, arguments and
 * environment, an HTTP one by its URL and headers.
 */
export const getMcpParamsFingerprint = (
  params: StdioMCPParams | HttpMCPClientParams,
): Promise<string> => {
  const address: McpServerAddress =
    params.type === 'stdio'
      ? { args: params.args ?? [], command: params.command, env: params.env, type: 'stdio' }
      : { headers: params.headers, type: 'http', url: params.url };
  return getMcpServerFingerprint(address);
};

/** The device an MCP App view's calls and reads are relayed to, in its pool. */
export interface McpRelayDevice {
  deviceId: string;
  workspaceId?: string;
}

const isDisplayMode = (value: unknown): value is 'inline' | 'fullscreen' =>
  value === 'inline' || value === 'fullscreen';

/**
 * A tunneled call's result state, with the MCP App view the device named kept
 * for relay (`keep`), or dropped.
 *
 * A kept view is rebuilt from what the server knows, not taken from the device:
 * its server is fingerprinted from the params the server sent (the device's
 * own fingerprint covers what it spawned, e.g. a login-shell PATH), and it
 * names the device that ran it (`relayDeviceId`, `relayWorkspaceId`), so any
 * client that opens the conversation reads the view and makes its calls
 * through the server, to that device.
 *
 * Keep a view only while the caller's `mcp_apps` flag is on and the device's
 * client serves views (`supportedMcpFeatures` includes `'apps'`): any other
 * result reads as plain, as it did before views were relayed.
 */
export const relayDeviceViewState = async <T>(
  state: T,
  {
    device,
    keep,
    params,
  }: { device: McpRelayDevice; keep: boolean; params: StdioMCPParams | HttpMCPClientParams },
): Promise<T | Record<string, unknown>> => {
  if (!state || typeof state !== 'object') return state;

  const { mcpApp, ...rest } = state as Record<string, unknown>;
  const view = mcpApp as { preferredModelDisplayMode?: unknown; resourceUri?: unknown } | undefined;
  if (!keep || typeof view?.resourceUri !== 'string' || !view.resourceUri.startsWith('ui://'))
    return rest;

  return {
    ...rest,
    mcpApp: {
      ...(isDisplayMode(view.preferredModelDisplayMode) && {
        preferredModelDisplayMode: view.preferredModelDisplayMode,
      }),
      relayDeviceId: device.deviceId,
      ...(device.workspaceId && { relayWorkspaceId: device.workspaceId }),
      resourceUri: view.resourceUri,
      server: await getMcpParamsFingerprint(params),
    },
  };
};
