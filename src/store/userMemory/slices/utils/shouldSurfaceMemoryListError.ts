interface MemoryListErrorContext {
  initialized: boolean;
  page: number;
  resetting?: boolean;
}

/**
 * Only replace a list with an error when its first page has no current content. Background
 * refresh and pagination failures must keep already-settled content visible.
 */
export const shouldSurfaceMemoryListError = ({
  initialized,
  page,
  resetting,
}: MemoryListErrorContext) => page === 1 && (Boolean(resetting) || !initialized);
