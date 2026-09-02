export interface RepairRerunOutcome {
  /** The repair prompt reached the origin conversation — the agent run has
      started, so offering a retry would double-run the repair. */
  dispatched: boolean;
  /** Post-dispatch bookkeeping (the `repairing` stamp) failed. Surface it if
      needed, but never re-enable the dispatch: the run is already live and the
      aggregate status converges when the next round lands. */
  markFailed: boolean;
}

/**
 * The standalone send-back is two server calls with different retry semantics:
 * a failed dispatch is safe to retry, while anything after a successful
 * dispatch is not. Collapse that boundary into one outcome so the caller
 * cannot accidentally treat "mark failed" as "dispatch failed".
 */
export const dispatchRepairRerun = async ({
  dispatch,
  markRepairing,
}: {
  dispatch: () => Promise<unknown>;
  markRepairing: () => Promise<unknown>;
}): Promise<RepairRerunOutcome> => {
  // Let a dispatch failure propagate — nothing started, the caller may retry.
  await dispatch();

  try {
    await markRepairing();
    return { dispatched: true, markFailed: false };
  } catch {
    return { dispatched: true, markFailed: true };
  }
};
