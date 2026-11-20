const WINDOW_MS = 60_000;

const lastLogged = new Map<string, { at: number; suppressed: number }>();

/**
 * Report a Redis-backed guard (rate limit, idempotency) that let a request
 * through because Redis failed. During an outage every API-key request takes
 * this path, so each guard logs at most once a minute and counts the requests
 * it admitted unguarded in between.
 */
export const logFailOpen = (guard: string, error: unknown) => {
  const now = Date.now();
  const entry = lastLogged.get(guard);
  if (entry && now - entry.at < WINDOW_MS) {
    entry.suppressed += 1;
    return;
  }
  console.error(
    `[openapi] ${guard} unavailable, admitting requests unguarded (${entry?.suppressed ?? 0} more in the last minute):`,
    error,
  );
  lastLogged.set(guard, { at: now, suppressed: 0 });
};
