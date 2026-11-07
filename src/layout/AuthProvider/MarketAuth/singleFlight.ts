/**
 * Collapse overlapping calls of an async operation onto a single execution.
 *
 * Built for OAuth token refresh, where the operation is not idempotent: Market
 * rotates refresh tokens, so a refresh token is single-use. Two overlapping
 * refreshes therefore don't merely waste a request — the second replays a token
 * the first already consumed and fails, and a naive failure handler treats that
 * phantom failure as "the session is dead" and discards the credentials the
 * first call just obtained.
 *
 * Collapsing them means the later caller observes the first call's real outcome
 * instead. Deliberately *not* a cache: the shared promise is released as soon as
 * it settles, so a subsequent call always performs fresh work.
 */
export const createSingleFlight = <T>(): ((_run: () => Promise<T>) => Promise<T>) => {
  let inFlight: Promise<T> | null = null;

  return (run: () => Promise<T>): Promise<T> => {
    if (inFlight) return inFlight;

    // Assign before awaiting so a caller arriving in the same tick — before any
    // microtask boundary — still sees the in-flight promise.
    const promise = run().finally(() => {
      inFlight = null;
    });
    inFlight = promise;

    return promise;
  };
};
