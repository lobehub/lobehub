import type { DeviceClient } from '@lobechat/types';
import debug from 'debug';

import { deviceGateway } from './index';

const log = debug('lobe-server:device-channels');

const DESKTOP_CHANNELS = new Set(['desktop', 'desktop-dev']);

/**
 * What kind of client is live on a device:
 * - `desktop` — only the LobeHub desktop app is connected (browser panel, MCP tunnel, …)
 * - `mixed` — the desktop app and `lh connect` are both connected. The gateway
 *   prefers the CLI channel and tool calls carry no channel hint, so a
 *   desktop-only call may still land on the CLI
 * - `cli-only` — only `lh connect` is connected; it handles local-system
 *   file/shell calls, plus whatever its system info opts into (browser,
 *   MCP tunnel)
 * - `unknown` — the device is not in the live list or reports no channel
 *   labels (older gateway); callers keep their previous behaviour
 */
export type DeviceClientKind = 'cli-only' | 'desktop' | 'mixed' | 'unknown';

/**
 * Resolve which client kind is live on `deviceId`, from the gateway's
 * presence list (the same source the run-target picker reads).
 *
 * Tool calls that only the desktop app can serve (browser, MCP tunnel) must
 * check this before dispatch: the gateway delivers a call to whichever
 * connection the device holds, and a CLI-only device cannot run it.
 */
export const clientKindFromChannels = (
  deviceChannels: ReadonlyArray<{ channel?: string | null }> | undefined,
): DeviceClientKind => {
  const channels = (deviceChannels ?? []).map((c) => c.channel).filter((c): c is string => !!c);
  if (channels.length === 0) return 'unknown';
  const desktopChannels = channels.filter((c) => DESKTOP_CHANNELS.has(c)).length;
  if (desktopChannels === 0) return 'cli-only';
  return desktopChannels === channels.length ? 'desktop' : 'mixed';
};

export const resolveDeviceClientKind = async (
  userId: string,
  deviceId: string,
  workspaceId?: string,
): Promise<DeviceClientKind> => {
  try {
    const devices = await deviceGateway.queryDeviceList(userId, workspaceId);
    return clientKindFromChannels(devices.find((d) => d.deviceId === deviceId)?.channels);
  } catch (error) {
    log('device presence lookup failed for %s: %O', deviceId, error);
    return 'unknown';
  }
};

/**
 * Which client on `deviceId` runs a tunneled MCP call (a stdio or
 * local-network server), or `undefined` when none of its clients can.
 *
 * The desktop app always can and wins whenever it is connected: one call per
 * device must land on one process, or a stateful stdio server's session would
 * split across the two clients. A device with only `lh connect` runs it when
 * that CLI reports `mcp` in `supportedToolCallTypes` — an older CLI
 * dispatched the call by apiName to a same-named local tool. `unknown`
 * presence keeps the desktop routing these calls always had.
 *
 * Pass `clientKind` when the caller already read the device's channels.
 */
export const resolveMcpClientKinds = async (
  userId: string,
  deviceId: string,
  workspaceId?: string,
  clientKind?: DeviceClientKind,
): Promise<DeviceClient[] | undefined> => {
  const kind = clientKind ?? (await resolveDeviceClientKind(userId, deviceId, workspaceId));
  if (kind !== 'cli-only') return ['desktop'];

  const cli = await deviceGateway.readDeviceSystemInfo(userId, deviceId, workspaceId, {
    clientKinds: ['cli'],
  });
  if (cli.ok && cli.systemInfo.supportedToolCallTypes?.includes('mcp')) return ['cli'];
  log(
    'cli-only device %s cannot run MCP calls: %s',
    deviceId,
    cli.ok ? 'CLI predates MCP support' : cli.reason,
  );
  return undefined;
};
