import type { DeviceListItem } from '@lobechat/types';

export type AutoTargetSummary<D = DeviceListItem> =
  { kind: 'pending' } | { device: D; kind: 'single' } | { kind: 'multiple' } | { kind: 'none' };

/**
 * Where an `auto` run will land, so the chip can say it instead of a bare
 * "Auto".
 *
 * Use when:
 * - The execution-target chip shows `auto` and needs the outcome the server
 *   will reach for the same pool (`resolveExecutionPlan`'s unbound branch)
 *
 * Expects:
 * - `pool` is the device pool the agent dispatches to (`devicePoolForAgent`),
 *   the same scope the server reads its online set from
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
