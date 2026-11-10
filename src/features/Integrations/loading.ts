interface ConnectionLookup {
  error?: unknown;
  isInitialLoading: boolean;
}

/**
 * Whether the integrations directory should still show its skeleton. A failed
 * lookup counts as settled (the integration reads as not enabled), so one
 * integration's error never hides the whole directory behind the skeleton.
 */
export const isDirectorySettling = (lookups: ConnectionLookup[]) =>
  lookups.some((lookup) => lookup.isInitialLoading && !lookup.error);
