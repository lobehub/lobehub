interface MemoryListPendingContext {
  error?: unknown;
  initialized: boolean;
  loading: boolean;
  resetting?: boolean;
}

/**
 * Full-surface loading is reserved for initial loads, resets, and error retries. Later pages
 * keep settled rows mounted while their list view renders incremental loading feedback.
 */
export const isMemoryListPending = ({
  error,
  initialized,
  loading,
  resetting,
}: MemoryListPendingContext) =>
  Boolean(resetting) || (!initialized && !error) || (Boolean(error) && loading);
