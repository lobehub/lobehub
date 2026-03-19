// Import zod for common schemas
import { z } from 'zod';

// ==================== Common Pagination Query Parameters ====================

/**
 * Common pagination query parameter interface
 */
export interface IPaginationQuery {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Common pagination query parameter Schema
 */
export const PaginationQuerySchema = z.object({
  keyword: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return ''; // Allow empty value, convert to empty string
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
