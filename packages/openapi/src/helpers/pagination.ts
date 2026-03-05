import type { IPaginationQuery } from '../types';

const DEFAULT_PAGE_SIZE = 20;

/**
 * 处理分页查询参数
 * @param request 查询参数对象
 * @returns 如果提供了分页参数，返回 { limit, offset }；否则返回空对象
 */
export function processPaginationConditions(request: Record<string, any> & IPaginationQuery): {
  limit?: number;
  offset?: number;
} {
  const { page, pageSize } = request;

  // 如果 page 和 pageSize 都未提供，则不进行分页（返回全部数据）
  if (page === undefined && pageSize === undefined) {
    return {};
  }

  // 只传了 page，则默认 pageSize 为 20
  if (page !== undefined && pageSize === undefined) {
    return {
      limit: DEFAULT_PAGE_SIZE,
      offset: (page - 1) * DEFAULT_PAGE_SIZE,
    };
  }

  // 只传了 pageSize，则默认 page 为 1
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
