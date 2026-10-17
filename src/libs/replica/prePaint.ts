/**
 * Upper bound for a route loader's pre-paint hydrate.
 *
 * The read itself is not the risk: measured on the real storage path, a warm
 * IndexedDB read of a sidebar page (20 rows ≈ 9 KB) is ~0.2–0.5 ms p50, the
 * first read of a cold page with an existing database ~1–10 ms, and creating
 * the database ~7–30 ms. The deadline only ever fires on a pathological storage
 * stall, so a route transition never waits longer than this for it.
 */
export const PRE_PAINT_HYDRATE_TIMEOUT = 50;

/** Resolve once `promise` settles or `ms` elapses — never rejects, never hangs. */
export const settleWithin = (promise: Promise<unknown>, ms: number): Promise<void> =>
  new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    void Promise.resolve(promise).then(finish, finish);
  });
