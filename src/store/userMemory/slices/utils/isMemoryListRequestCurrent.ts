interface MemoryListRequest {
  page: number;
  q?: string;
  sort?: string;
}

/**
 * Reject responses from a list state that was replaced by a search, sort, or pagination reset.
 * Earlier pages remain valid after pagination advances, so only pages beyond the current one are stale.
 */
export const isMemoryListRequestCurrent = (
  current: MemoryListRequest,
  request: MemoryListRequest,
) => current.page >= request.page && current.q === request.q && current.sort === request.sort;
