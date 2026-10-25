/**
 * Resolve once `promise` settles or `ms` elapses — never rejects, never hangs.
 *
 * Bounds a pre-paint hydrate in a route loader: the persisted read is usually
 * sub-millisecond, and the deadline only fires on a pathological storage stall,
 * so a route transition never waits longer than `ms` for it.
 */
export const settleWithin = (promise: Promise<unknown>, ms: number): Promise<void> =>
  new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    void Promise.resolve(promise).then(finish, finish);
  });
