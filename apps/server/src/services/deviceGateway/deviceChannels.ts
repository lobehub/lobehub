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
 *   file/shell calls and answers anything else with `Unknown tool API`
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
export const resolveDeviceClientKind = async (
  userId: string,
  deviceId: string,
  workspaceId?: string,
): Promise<DeviceClientKind> => {
  try {
    const devices = await deviceGateway.queryDeviceList(userId, workspaceId);
    const device = devices.find((d) => d.deviceId === deviceId);
    const channels = (device?.channels ?? []).map((c) => c.channel).filter((c): c is string => !!c);
    if (channels.length === 0) return 'unknown';
    const desktopChannels = channels.filter((c) => DESKTOP_CHANNELS.has(c)).length;
    if (desktopChannels === 0) return 'cli-only';
    return desktopChannels === channels.length ? 'desktop' : 'mixed';
  } catch (error) {
    log('device presence lookup failed for %s: %O', deviceId, error);
    return 'unknown';
  }
};
