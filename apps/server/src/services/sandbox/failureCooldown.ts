/**
 * How long a failed upstream is left alone. A run resolves its placement several
 * times — the prompt, then every tool call — so without this an outage is asked
 * about again every few seconds by every run, each one waiting to learn the
 * answer it is about to degrade over anyway.
 */
export const SANDBOX_FAILURE_COOLDOWN_MS = 15_000;

/** A long-lived server sees every workspace's drives, so this sheds the oldest rather than grow. */
const MAX_ENTRIES = 1000;

/**
 * Remembers which keys just failed, per server instance. Only failures are
 * kept, and only briefly: the first call after the window asks upstream again,
 * so recovery needs no invalidation.
 */
export const createFailureCooldown = () => {
  const failedAt = new Map<string, number>();

  return {
    /** Forget one key, or every key when none is given. */
    clear: (key?: string) => {
      if (key === undefined) failedAt.clear();
      else failedAt.delete(key);
    },
    /** Whether `key` failed recently enough that it should not be asked again yet. */
    isCoolingDown: (key: string) => {
      const at = failedAt.get(key);
      if (at === undefined) return false;
      if (Date.now() - at < SANDBOX_FAILURE_COOLDOWN_MS) return true;

      failedAt.delete(key);
      return false;
    },
    record: (key: string) => {
      failedAt.delete(key);
      while (failedAt.size >= MAX_ENTRIES) {
        const oldest = failedAt.keys().next().value;
        if (oldest === undefined) break;
        failedAt.delete(oldest);
      }
      failedAt.set(key, Date.now());
    },
    size: () => failedAt.size,
  };
};

export type SandboxDegradedLayer = 'drive' | 'entitlement' | 'topic';

/**
 * The line an operator greps for: a placement that fell back because something
 * FAILED, naming the layer that did. Deliberately not `debug` — it has to show
 * up whatever `DEBUG` is set to — and deliberately not used for the healthy
 * ephemeral branches (a free plan, no folder picked), which are most runs.
 */
export const warnSandboxDegraded = (
  layer: SandboxDegradedLayer,
  details: Record<string, unknown>,
  error: unknown,
) => {
  console.warn(
    JSON.stringify({
      ...details,
      error: error instanceof Error ? error.message : String(error),
      event: 'sandbox.placement.degraded',
      layer,
    }),
  );
};
