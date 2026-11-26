import type { DeviceListItem } from '@lobechat/types';

import { devicePoolForAgent, groupExecutionTargetDevices } from '@/features/ExecutionTargetPicker';

export type AutoTargetSummary<D = DeviceListItem> =
  { kind: 'pending' } | { device: D; kind: 'single' } | { kind: 'multiple' } | { kind: 'none' };

/**
 * The devices an `auto` run dispatches among, as the server builds them.
 *
 * Use when:
 * - Summarizing an `auto` target: the agent's own pool alone misses a device
 *   the server adds to it
 *
 * Expects:
 * - `boundDeviceId` is the effective config's binding (a member override
 *   keeps the personal device picked under "This computer" when switching to
 *   `auto`)
 *
 * Returns:
 * - The agent's pool (`devicePoolForAgent`); for a workspace agent, plus the
 *   caller's personal device that `boundDeviceId` names. The server unions it
 *   into the workspace run's online set (`readOnlineDevices`), and
 *   `resolveExecutionPlan` counts it among the `auto` candidates.
 */
export const autoDispatchPool = ({
  boundDeviceId,
  devices,
  isWorkspaceAgent,
}: {
  boundDeviceId?: string | null;
  devices: DeviceListItem[] | undefined;
  isWorkspaceAgent: boolean;
}): DeviceListItem[] => {
  const pool = devicePoolForAgent(devices, isWorkspaceAgent);
  if (!isWorkspaceAgent || !boundDeviceId || pool.some((d) => d.deviceId === boundDeviceId)) {
    return pool;
  }

  const bound = groupExecutionTargetDevices(devices).personal.find(
    (device) => device.deviceId === boundDeviceId,
  );

  return bound ? [...pool, bound] : pool;
};

/**
 * Where an `auto` run will land, so the chip can say it instead of a bare
 * "Auto".
 *
 * Use when:
 * - The execution-target chip shows `auto` and needs the outcome the server
 *   will reach for the same pool (`resolveExecutionPlan`'s unbound branch)
 *
 * Expects:
 * - `pool` is the device pool the run dispatches to (`autoDispatchPool`),
 *   the same set the server reads its online devices from
 *
 * Returns:
 * - `pending` until the server confirmed the list and every row's presence:
 *   a stored copy's `online: false` is a placeholder, not a fact
 * - `single` with the one online device, which the run uses directly
 * - `multiple` when several are online, and the Agent picks one per run
 * - `none` when nothing is online, and the run gets no device
 */
export const summarizeAutoTarget = <D extends Pick<DeviceListItem, 'online' | 'onlineUnknown'>>({
  isConfirmed,
  pool,
}: {
  isConfirmed: boolean;
  pool: D[];
}): AutoTargetSummary<D> => {
  if (!isConfirmed || pool.some((device) => device.onlineUnknown)) return { kind: 'pending' };

  const online = pool.filter((device) => device.online);
  if (online.length === 1) return { device: online[0], kind: 'single' };
  if (online.length > 1) return { kind: 'multiple' };

  return { kind: 'none' };
};
