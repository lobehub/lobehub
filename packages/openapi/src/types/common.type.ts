// Import zod for common schemas
import { z } from 'zod';

import { CursorPaginationQuerySchema, legacyPageQueryShape } from '../helpers/pagination';

// ==================== Common Pagination Query Parameters ====================

/**
 * Common pagination query parameter interface
 */
export interface IPaginationQuery {
  cursor?: string;
  keyword?: string;
  limit?: number;
  page?: number;
  pageSize?: number;
}

/**
 * Common pagination query parameter Schema: `cursor` + `limit`, plus the
 * deprecated `page`/`pageSize` existing clients still send. See
 * `helpers/pagination.ts` for the list contract.
 */
export const PaginationQuerySchema = z.object({
  ...CursorPaginationQuerySchema.shape,
  keyword: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return ''; // Allow empty value, convert to empty string
      return val.trim();
    })
    .refine((val) => val.length <= 100, 'Search keyword cannot exceed 100 characters'),
  ...legacyPageQueryShape,
});

export type PaginationQueryResponse<T = any> = {
  total: number;
} & T;

// ==================== Common Response Schemas ====================

/** Timestamps leave the API as ISO 8601 strings (`Date` serialized by `c.json`). */
export const dateTimeSchema = z.string().meta({ format: 'date-time' });

/** A stored JSON object column whose keys are owned by the client or a plugin. */
export const jsonObjectSchema = z.record(z.string(), z.unknown());

/**
 * What a single-resource DELETE answers with: the id that is now gone. Every
 * DELETE returns this (or `DeletedResources` for bulk removals) instead of an
 * empty body, so clients can confirm which resource the call removed.
 */
export const DeletedResourceSchema = z
  .object({ deleted: z.literal(true), id: z.string() })
  .strict()
  .meta({ id: 'DeletedResource' });

/** What a bulk DELETE answers with: how many rows the call removed. */
export const DeletedResourcesSchema = z
  .object({ count: z.number().int().min(0), deleted: z.literal(true) })
  .strict()
  .meta({ id: 'DeletedResources' });

export type DeletedResource = z.infer<typeof DeletedResourceSchema>;
export type DeletedResources = z.infer<typeof DeletedResourcesSchema>;
