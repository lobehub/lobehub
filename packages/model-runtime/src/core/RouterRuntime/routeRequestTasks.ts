/** Keep request-scoped background work alive until the stream and its callbacks settle. */
export const createRouteRequestTasks = async (
  schedule: (settled: Promise<void>) => void | Promise<void>,
) => {
  let resolveTerminal!: () => void;
  const terminal = new Promise<void>((resolve) => (resolveTerminal = resolve));
  const pending = new Set<Promise<void>>();
  const settled = (async () => {
    await terminal;
    while (pending.size > 0) await Promise.allSettled(pending);
  })();

  try {
    await schedule(settled);
  } catch (error) {
    console.error('[RouterRuntime] Failed to schedule route request work:', error);
  }

  return {
    settle: resolveTerminal,
    track(task: Promise<void>) {
      const observed = Promise.resolve(task).catch((error) => {
        console.error('[RouterRuntime] Route request work failed:', error);
      });
      pending.add(observed);
      void observed.then(() => pending.delete(observed));
    },
  };
};
