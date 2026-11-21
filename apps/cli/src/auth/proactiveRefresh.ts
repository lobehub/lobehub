// How far before expiry to proactively refresh (1 hour)
const PROACTIVE_REFRESH_BUFFER = 60 * 60;

/**
 * Parse the `exp` claim from a JWT without verifying the signature.
 */
function parseJwtExp(token: string): number | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return typeof payload.exp === 'number' ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Schedule a proactive token refresh before the (connect) token expires.
 * `refresh` performs the actual refresh — re-minting a workspace token or
 * refreshing the user token — and returns the new token. Returns a cleanup
 * function that cancels the scheduled timer.
 */
export function scheduleProactiveRefresh(
  token: string,
  tokenType: string,
  refresh: () => Promise<string | undefined>,
  info: (msg: string) => void,
  error: (msg: string) => void,
): (() => void) | null {
  if (tokenType !== 'jwt') return null;

  const exp = parseJwtExp(token);
  if (!exp) return null;

  const lifetimeMs = exp * 1000 - Date.now();
  if (lifetimeMs <= 0) {
    // Token already expired — refresh once on next tick.
    void doRefresh();
    return null;
  }

  // Refresh ahead of expiry, but never let the buffer meet or exceed the token's
  // remaining lifetime: a buffer >= lifetime collapses the refresh window to <=0
  // and busy-loops re-minting (e.g. a 1h token with a 1h buffer). Cap the buffer
  // at half the remaining lifetime so a short-lived token refreshes about once per
  // half-life instead of spinning.
  const bufferMs = Math.min(PROACTIVE_REFRESH_BUFFER * 1000, lifetimeMs / 2);
  const delay = lifetimeMs - bufferMs;

  const timer = setTimeout(() => void doRefresh(), delay);
  return () => clearTimeout(timer);

  async function doRefresh() {
    try {
      const newToken = await refresh();
      if (!newToken) {
        error('Proactive token refresh failed — no valid credentials.');
        return;
      }
      if (newToken !== token) info('Proactively refreshed token.');
    } catch {
      error('Proactive token refresh failed.');
    }
  }
}
