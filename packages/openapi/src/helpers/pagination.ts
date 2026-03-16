import type { IPaginationQuery } from '../types';

const DEFAULT_PAGE_SIZE = 20;

/**
 * Process pagination query parameters
 * @param request Query parameter object
 * @returns { limit, offset } if pagination parameters are provided; otherwise an empty object
 */
export function processPaginationConditions(request: Record<string, any> & IPaginationQuery): {
  limit?: number;
  offset?: number;
} {
  const { page, pageSize } = request;

  // If neither page nor pageSize is provided, skip pagination (return all data)
  if (page === undefined && pageSize === undefined) {
    return {};
  }

  // If only page is provided, default pageSize to 20
  if (page !== undefined && pageSize === undefined) {
    return {
      limit: DEFAULT_PAGE_SIZE,
      offset: (page - 1) * DEFAULT_PAGE_SIZE,
    };
  }

  // If only pageSize is provided, default page to 1
  if (page === undefined && pageSize !== undefined) {
    return {
      limit: pageSize,
      offset: 0,
    };
  }

  return {
    limit: pageSize,
    offset: (page! - 1) * pageSize!,
  };
}
