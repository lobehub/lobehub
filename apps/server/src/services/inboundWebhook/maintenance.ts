/** Delay before the next maintenance attempt after `failures` failed ones: 2 min doubling, at most 6 h. */
export const maintenanceBackoff = (failures: number) =>
  Math.min(6 * 3_600_000, 60_000 * 2 ** Math.min(failures, 9));
