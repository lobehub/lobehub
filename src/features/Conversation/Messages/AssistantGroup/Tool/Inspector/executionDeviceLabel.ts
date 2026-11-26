import { LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import { TOOL_CALL_DEVICE_ARG, type ToolExecutionDeviceState } from '@lobechat/types';

export interface ExecutionDeviceLabel {
  /** What the row shows: the device's alias, hostname, or the requested value. */
  label: string;
  /** The device id when known, for the hover title. */
  title: string;
}

/**
 * The device a Local System call row names, when the call picked one with its
 * `device` argument: the device that executed it once the result is in,
 * otherwise (still running, or refused) the device it asked for. A call on the
 * conversation's own device names none; the chat input already shows it.
 */
export const getExecutionDeviceLabel = ({
  args,
  identifier,
  pluginState,
}: {
  args?: unknown;
  identifier: string;
  pluginState?: unknown;
}): ExecutionDeviceLabel | undefined => {
  if (identifier !== LocalSystemIdentifier) return;
  const value = (args as Record<string, unknown> | null | undefined)?.[TOOL_CALL_DEVICE_ARG];
  const requested = typeof value === 'string' ? value.trim() : '';
  if (!requested) return;

  const device = (pluginState as ToolExecutionDeviceState | null | undefined)?.executionDevice;
  if (!device) return { label: requested, title: requested };
  return { label: device.name || device.hostname || device.deviceId, title: device.deviceId };
};
