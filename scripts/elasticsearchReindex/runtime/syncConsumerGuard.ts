/**
 * Decides whether a schema upgrade may start, resume, or cut over given the current Outbox
 * counters. Kept free of I/O so the rule is unit-testable.
 */
export const assertSyncConsumerPausedFor = ({
  dead,
  inFlight,
}: {
  dead: number;
  inFlight: number;
}) => {
  /** Active leases are the observable sign that the incremental sync consumer is still running. */
  if (inFlight > 0) {
    throw new Error(
      `Outbox still has ${inFlight} in-flight claims; pause the incremental sync consumer first`,
    );
  }
  /**
   * A dead letter is a change the old index never received and that nothing replays on its own.
   * Copying or cutting over on top of it would freeze that stale document into the new index, so
   * dead work fails the upgrade instead of publishing a successful switch.
   */
  if (dead > 0) {
    throw new Error(
      `Outbox has ${dead} dead letters; resolve them (see --status) before switching aliases`,
    );
  }
};
