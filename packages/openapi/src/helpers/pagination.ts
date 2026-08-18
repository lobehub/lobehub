import type { IPaginationQuery } from '../types';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Process pagination query parameters
 * @param request Query parameter object
 * @returns a bounded limit/offset pair; omitted pagination defaults to page 1 / 20 items
 */
export function processPaginationConditions(request: Record<string, any> & IPaginationQuery): {
  limit?: number;
  offset?: number;
} {
  const page = Math.max(1, request.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, request.pageSize ?? DEFAULT_PAGE_SIZE));

  return {
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
}
