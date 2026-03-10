// 引入 zod 用于通用 schema
import { z } from 'zod';

// ==================== 通用分页查询参数 ====================

/**
 * 通用分页查询参数接口
 */
export interface IPaginationQuery {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

/**
 * 通用分页查询参数 Schema
 */
export const PaginationQuerySchema = z.object({
  keyword: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return ''; // 允许为空，转换为空字符串
      return val.trim();
    })
    .refine((val) => val.length <= 100, '搜索关键词长度不能超过100个字符'),
  page: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(1))
    .optional(),
  pageSize: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().min(1).max(100))
    .optional(),
});

export type PaginationQueryResponse<T = any> = {
  total: number;
} & T;
