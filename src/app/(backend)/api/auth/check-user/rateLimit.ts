/**
 * In-process sliding-window limiter for the public check-user oracle (AUTH-001).
 * Not a substitute for edge/WAF limits, but stops unbounded enumeration on a single node.
 */

export type CheckUserRateLimitOptions = {
  max: number;
  windowMs: number;
};

const DEFAULT_OPTIONS: CheckUserRateLimitOptions = {
  max: 10,
  windowMs: 60_000,
};

const hitsByKey = new Map<string, number[]>();

export const consumeCheckUserRateLimit = (
  key: string,
  options: CheckUserRateLimitOptions = DEFAULT_OPTIONS,
): boolean => {
  const now = Date.now();
  const windowStart = now - options.windowMs;
  const recent = (hitsByKey.get(key) ?? []).filter((ts) => ts > windowStart);

  if (recent.length >= options.max) {
    hitsByKey.set(key, recent);
    return false;
  }

  recent.push(now);
  hitsByKey.set(key, recent);
  return true;
};

/** Test-only helper — clears the in-memory window. */
export const resetCheckUserRateLimitForTests = () => {
  hitsByKey.clear();
};
