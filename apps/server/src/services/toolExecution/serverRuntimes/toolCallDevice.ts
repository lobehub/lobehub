import { type DeviceAttachment } from '@lobechat/builtin-tool-remote-device';
import { TOOL_CALL_DEVICE_ARG, type ToolExecutionDevice } from '@lobechat/types';
import { toRecord } from '@lobechat/utils/object';
import debug from 'debug';

import { DeviceModel } from '@/database/models/device';
import {
  awaitManagedDeviceForToolCall,
  type buildDeviceWakingResult,
} from '@/server/services/deviceGateway/managedDeviceWake';
import { getScopedOnlineDevices } from '@/server/services/deviceGateway/scopedDevices';

import { type ToolExecutionContext } from '../types';
import { resolveRunWorkspaceId } from './resolveWorkspaceScope';

const log = debug('lobe-server:tool-call-device');

export const TOOL_CALL_DEVICE_ERROR = {
  ambiguous: 'DEVICE_AMBIGUOUS',
  notAccessible: 'DEVICE_NOT_ACCESSIBLE',
  offline: 'DEVICE_OFFLINE',
  unavailable: 'DEVICE_SELECTION_UNAVAILABLE',
} as const;

/** How many reachable devices a refusal lists for the model to choose from. */
const LISTED_DEVICE_LIMIT = 10;

type ToolCallDeviceContext = Pick<
  ToolExecutionContext,
  | 'activeDeviceId'
  | 'activeDeviceScope'
  | 'agentId'
  | 'agentShareVisitor'
  | 'deviceCapable'
  | 'deviceSelectionFixed'
  | 'serverDB'
  | 'userId'
  | 'workspaceId'
>;

/** Where one device tool call runs. */
export interface ToolCallDeviceRoute {
  device: ToolExecutionDevice;
  deviceId: string;
  /** Gateway pool the device is addressed in; `undefined` is the personal pool. */
  workspaceId?: string;
}

/** A call that names a device it cannot run on. Nothing was dispatched. */
export interface ToolCallDeviceRefusal {
  content: string;
  error: { code: string; kind: 'stop'; message: string; requestedDevice: string };
  success: false;
}

/** A refusal, or a managed cloud device that is still starting. */
export type ToolCallDeviceFailure =
  ToolCallDeviceRefusal | ReturnType<typeof buildDeviceWakingResult>;

/**
 * Splits the per-call `device` argument off a device tool call's arguments,
 * which go to the device without it.
 *
 * Returns:
 * - `requested`: the trimmed device the call named; absent for a missing,
 *   `null` or blank value, which all mean "the run's device"
 * - `invalid`: the call named a device with a non-string value. It must fail,
 *   not run on the run's device: the model asked for a device it cannot have.
 */
export const takeToolCallDeviceArg = (
  args: unknown,
): { args: Record<string, unknown>; invalid?: boolean; requested?: string } => {
  const { [TOOL_CALL_DEVICE_ARG]: value, ...rest } = toRecord(args) ?? {};
  if (value === undefined || value === null) return { args: rest };
  if (typeof value !== 'string') return { args: rest, invalid: true };
  const requested = value.trim();
  return requested ? { args: rest, requested } : { args: rest };
};

const deviceLabel = (device: Pick<DeviceAttachment, 'deviceId' | 'friendlyName' | 'hostname'>) =>
  device.friendlyName || device.hostname || device.deviceId;

const describeDevices = (devices: DeviceAttachment[]) =>
  devices
    .slice(0, LISTED_DEVICE_LIMIT)
    .map((device) => `"${deviceLabel(device)}" (${device.deviceId})`)
    .join(', ');

export const buildToolCallDeviceFailure = (
  code: string,
  requestedDevice: string,
  message: string,
): ToolCallDeviceRefusal => ({
  content: message,
  error: { code, kind: 'stop', message, requestedDevice },
  success: false,
});

const toExecutionDevice = (device: DeviceAttachment, requested: boolean): ToolExecutionDevice => ({
  deviceId: device.deviceId,
  hostname: device.hostname || undefined,
  name: device.friendlyName || undefined,
  requested,
  scope: device.scope,
});

/**
 * The devices a `device` value names: an exact device id, otherwise a
 * case-insensitive alias or hostname.
 */
const matchDevices = (devices: DeviceAttachment[], requested: string): DeviceAttachment[] => {
  const byId = devices.filter((device) => device.deviceId === requested);
  if (byId.length > 0) return byId.slice(0, 1);
  const name = requested.toLowerCase();
  return devices.filter((device) =>
    [device.friendlyName, device.hostname].some((value) => value?.toLowerCase() === name),
  );
};

/**
 * Resolves the device a single tool call named through its `device` argument.
 *
 * The call may reach exactly the devices `lobe-remote-device.activateDevice`
 * may: the same scoped pool (`resolveRunWorkspaceId` + `getScopedOnlineDevices`),
 * so the argument grants nothing a run could not already do — it only skips
 * rebinding the run. Anything it cannot reach fails the call; it never runs
 * on another machine instead.
 *
 * Refused without any lookup when the run may not choose devices at all:
 * a share visitor, a run whose plan is not device-capable, or an agent whose
 * workspace fixed its execution device.
 *
 * Returns:
 * - `{ route }` for an online device (a sleeping managed cloud device is woken
 *   first, like `activateDevice` does)
 * - `{ failure }` with the reason otherwise
 */
export const resolveToolCallDevice = async (
  context: ToolCallDeviceContext,
  requested: string,
): Promise<{ failure: ToolCallDeviceFailure } | { route: ToolCallDeviceRoute }> => {
  if (context.agentShareVisitor || context.deviceCapable === false) {
    return {
      failure: buildToolCallDeviceFailure(
        TOOL_CALL_DEVICE_ERROR.unavailable,
        requested,
        `This conversation cannot run tools on the user's devices, so the call was not run on "${requested}" or anywhere else.`,
      ),
    };
  }
  if (context.deviceSelectionFixed) {
    return {
      failure: buildToolCallDeviceFailure(
        TOOL_CALL_DEVICE_ERROR.unavailable,
        requested,
        `This agent's workspace fixed the device it runs on, so the call was not run on "${requested}" or anywhere else. Omit "${TOOL_CALL_DEVICE_ARG}" to run it on the agent's device, or ask a workspace editor to change the agent's device policy.`,
      ),
    };
  }
  if (!context.serverDB || !context.userId) {
    return {
      failure: buildToolCallDeviceFailure(
        TOOL_CALL_DEVICE_ERROR.unavailable,
        requested,
        `Access to device "${requested}" cannot be checked here, so the call was not run.`,
      ),
    };
  }

  const workspaceId = await resolveRunWorkspaceId(context);
  const devices = await getScopedOnlineDevices(context.serverDB, context.userId, workspaceId);
  const matches = matchDevices(devices, requested);
  log(
    'device arg %o: workspace=%o, %d candidate(s), %d match(es)',
    requested,
    workspaceId,
    devices.length,
    matches.length,
  );

  if (matches.length > 1) {
    return {
      failure: buildToolCallDeviceFailure(
        TOOL_CALL_DEVICE_ERROR.ambiguous,
        requested,
        `"${requested}" names several devices: ${describeDevices(matches)}. The call was not run. Ask the user which one they mean, then pass its device ID.`,
      ),
    };
  }

  const [device] = matches;
  if (!device) {
    const online = devices.filter((candidate) => candidate.online);
    const available =
      online.length > 0
        ? `Online devices this conversation can use: ${describeDevices(online)}.`
        : 'No device this conversation can use is online.';
    return {
      failure: buildToolCallDeviceFailure(
        TOOL_CALL_DEVICE_ERROR.notAccessible,
        requested,
        `Device "${requested}" is not one of the devices this conversation can use (the user's own devices, or the devices shared with this workspace), so the call was not run on it or anywhere else. ${available}`,
      ),
    };
  }

  if (!device.online) {
    const managed = await awaitManagedDeviceForToolCall(
      { db: context.serverDB, userId: context.userId, workspaceId },
      device.deviceId,
    );
    if (managed && managed !== 'online') return { failure: managed };
    if (!managed) {
      return {
        failure: buildToolCallDeviceFailure(
          TOOL_CALL_DEVICE_ERROR.offline,
          requested,
          `Device "${deviceLabel(device)}" (${device.deviceId}) is offline, so the call was not run on it or anywhere else. Tell the user to bring it online (open the desktop app or run \`lh connect\` on it), then retry.`,
        ),
      };
    }
  }

  return {
    route: {
      device: toExecutionDevice(device, true),
      deviceId: device.deviceId,
      workspaceId,
    },
  };
};

/**
 * Describes the run's own device for a call's result. Best effort: a device
 * without a registry row (or a failed lookup) is reported by id alone.
 */
export const describeRunDevice = async (
  context: Pick<ToolExecutionContext, 'serverDB' | 'userId'>,
  deviceId: string,
  workspaceId: string | undefined,
): Promise<ToolExecutionDevice> => {
  const base: ToolExecutionDevice = {
    deviceId,
    requested: false,
    scope: workspaceId ? 'workspace' : 'personal',
  };
  if (!context.serverDB || !context.userId) return base;
  try {
    const model = new DeviceModel(context.serverDB, context.userId, workspaceId);
    const row = workspaceId
      ? await model.findWorkspaceDeviceById(deviceId)
      : await model.findPersonalByDeviceId(deviceId);
    return {
      ...base,
      hostname: row?.hostname || undefined,
      name: row?.friendlyName || undefined,
    };
  } catch (error) {
    log('device %s lookup failed: %O', deviceId, error);
    return base;
  }
};

/** Records on a device result which device executed the call. */
export const withExecutionDevice = <T extends { state?: unknown }>(
  result: T,
  device: ToolExecutionDevice,
): T => ({
  ...result,
  state: { ...toRecord(result.state), executionDevice: device },
});
