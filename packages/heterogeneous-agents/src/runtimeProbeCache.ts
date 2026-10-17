/** Default lifetime of a cached native runtime probe. */
export const RUNTIME_PROBE_TTL_MS = 10 * 60 * 1000;

export interface RuntimeProbeCache {
  /** Returns the cached probe, starting one when none is cached or the entry expired. */
  get: () => Promise<string[]>;
  /** Drops the cached probe; the next `get` probes again. */
  invalidate: () => void;
}

/**
 * Caches a device's native agent runtime probe for one connection.
 *
 * Use when:
 * - Answering gateway `system_info_request`s, which run tools and agent dispatch both
 *   issue during ordinary runs. Each probe starts a native process, so it must not run
 *   once per request.
 * Expects:
 * - `probe` resolves (never rejects) to the supported runtime identifiers.
 * - The owner calls `invalidate` when its gateway connection is (re-)established, so a
 *   reconnect after an upgrade or downgrade reprobes.
 * Returns:
 * - A cache whose concurrent callers share one in-flight probe. Entries expire after
 *   `ttlMs`, so a Codex install or upgrade is also picked up without reconnecting.
 */
export const createRuntimeProbeCache = (
  probe: () => Promise<string[]>,
  { now = Date.now, ttlMs = RUNTIME_PROBE_TTL_MS }: { now?: () => number; ttlMs?: number } = {},
): RuntimeProbeCache => {
  let entry: { startedAt: number; value: Promise<string[]> } | undefined;
  return {
    get: () => {
      if (!entry || now() - entry.startedAt >= ttlMs) {
        const current = {
          startedAt: now(),
          value: probe().catch(() => [] as string[]),
        };
        entry = current;
      }
      return entry.value;
    },
    invalidate: () => {
      entry = undefined;
    },
  };
};
