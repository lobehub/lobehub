/**
 * The Claude Code account an agent uses on one device. A login only exists on
 * the machine it was signed in on, so the Manual pick is made per device;
 * `accountId: null` means that device runs in Auto mode.
 */
export interface QuotaDeviceAccount {
  accountId: string | null;
}

/**
 * Whether an agent would find quota where it runs, judged on the accounts the
 * dispatcher would route it to there (its device's pick, a legacy pin, or the
 * pool's candidates). Presence reads it; a scheduler can check it before
 * dispatching.
 *
 * - `available`: at least one of those accounts has headroom;
 * - `exhausted`: every one of them is spent;
 * - `untracked`: none of the agent's accounts is routed there, so the run uses
 *   the device's default login and its quota is not judged.
 */
export interface QuotaAgentAvailability {
  /** Accounts judged, as the dispatcher would try them; empty when `untracked`. */
  accountIds: string[];
  /** `pinned`: the run must use the one account; `balanced`: it may use any. */
  mode?: 'balanced' | 'pinned';
  /**
   * When `exhausted`: the earliest moment one account comes back (ms epoch).
   * Absent when a limit that benches an account gives no reset time.
   */
  resetsAt?: number;
  status: 'available' | 'exhausted' | 'untracked';
}
