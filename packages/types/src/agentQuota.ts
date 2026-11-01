/**
 * The Claude Code account an agent uses on one device. A login only exists on
 * the machine it was signed in on, so the Manual pick is made per device;
 * `accountId: null` means that device runs in Auto mode.
 */
export interface QuotaDeviceAccount {
  accountId: string | null;
}
