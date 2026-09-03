import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';

/**
 * Structured "no active device" tool result for the device-proxy server
 * runtimes (local-system / browser).
 *
 * These runtimes are registered only in device-capable runs, but
 * `context.activeDeviceId` can legitimately be empty:
 *
 * - Type 1 — never bound: a `device-unrouted` run advertises the device tools
 *   on purpose (mid-run activation via `lobe-remote-device` is a supported
 *   flow), so a call can arrive before any device was activated.
 * - Type 2 — lost mid-run: the device dropped offline between steps, the next
 *   operation re-resolves its plan to `device-unrouted`
 *   (`bound-device-offline`), and `metadata.activeDeviceId` is cleared.
 *
 * Historically the runtime factory guards threw a bare
 * `activeDeviceId is required for ...` error string. The model received no
 * recovery path (multiple agent vent reports across different users/topics
 * show agents stalling on exactly this), so the guards now return this
 * structured, actionable result instead:
 *
 * - When the remote-device picker is reachable (its manifest is in the tool
 *   set), the error points the model at `listOnlineDevices` +
 *   `activateDevice`. Note the NEXT call takes effect: the activated device id
 *   folds back into run metadata at the next step boundary.
 * - When the picker is NOT reachable (device-locked run whose device went
 *   offline — the picker is physically stripped), the only path is the user
 *   reconnecting the desktop application or cli, so the message says to tell the user.
 */
export const NO_ACTIVE_DEVICE_ERROR_CODE = 'NO_ACTIVE_DEVICE';

export const buildNoActiveDeviceResult = (
  toolLabel: string,
  {
    remoteDeviceToolAvailable = true,
  }: {
    remoteDeviceToolAvailable?: boolean;
  } = {},
): { content: string; error: { code: string; message: string }; success: false } => {
  const recovery = remoteDeviceToolAvailable
    ? `Call lobe-remote-device.listOnlineDevices to refresh the device list, then activateDevice with an online device id. The activation takes effect on the NEXT step — after it succeeds, retry this call. If no device is online, tell the user to connect the desktop application or cli.`
    : `This conversation is locked to a specific device that is currently offline — the device picker is not available. Tell the user to reconnect the desktop application or cli, then retry.`;

  const message = `No active device for ${toolLabel} execution. ${recovery}`;

  return {
    content: message,
    error: { code: NO_ACTIVE_DEVICE_ERROR_CODE, message },
    success: false,
  };
};

/** Manifest identifier of the remote-device picker, for reachability checks. */
export const REMOTE_DEVICE_TOOL_IDENTIFIER: string = RemoteDeviceManifest.identifier;
