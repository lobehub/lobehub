import { z } from 'zod';

import { ApiException } from '../common/errors';
import type { IPaginationQuery } from '../types';

/**
 * The list contract every collection endpoint follows:
 *
 * - request: `limit` (1–100, default 20) and an opaque `cursor` taken from the
 *   previous page's `nextCursor`. New endpoints accept only these two.
 * - response: `{ <items>, total?, hasMore, nextCursor }` inside `data`, where
 *   `<items>` is `items` for new endpoints (existing ones keep their key, e.g.
 *   `agents`) and `nextCursor` is `null` on the last page.
 *
 * Endpoints that predate the contract still accept `page`/`pageSize` and
 * `offset`; the spec marks those parameters deprecated.
 */

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

const OFFSET_CURSOR_PREFIX = 'o:';

/** Opaque cursor for an offset-backed list. Clients must not build or parse it. */
export const encodeOffsetCursor = (offset: number): string =>
  Buffer.from(`${OFFSET_CURSOR_PREFIX}${offset}`).toString('base64url');

/** The offset a cursor from {@link encodeOffsetCursor} stands for; rejects anything else. */
export const decodeOffsetCursor = (cursor: string): number => {
  const decoded = Buffer.from(cursor, 'base64url').toString();
  const offset = decoded.startsWith(OFFSET_CURSOR_PREFIX)
    ? Number(decoded.slice(OFFSET_CURSOR_PREFIX.length))
    : Number.NaN;

  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ApiException(400, 'validation_error', 'Invalid request: query.cursor is not valid', [
      { message: 'Not a cursor returned by this endpoint', path: 'query.cursor' },
    ]);
  }
  return offset;
};

const coercedInt = (min: number, max?: number) => {
  const int = z.coerce.number().int().min(min);
  return max === undefined ? int : int.max(max);
};

/** `cursor` + `limit`: the pagination query of every new list endpoint. */
export const CursorPaginationQuerySchema = z.object({
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe("Opaque cursor from the previous page's `nextCursor`. Omit for the first page."),
  limit: coercedInt(1, MAX_PAGE_LIMIT)
    .optional()
    .describe(`Page size, 1–${MAX_PAGE_LIMIT}. Defaults to ${DEFAULT_PAGE_LIMIT}.`),
});

const deprecated = <T extends z.ZodType>(schema: T, replacement: string) =>
  schema.meta({ deprecated: true, description: `Deprecated: use ${replacement} instead.` });

/** Legacy `page`/`pageSize` parameters, kept for existing clients and marked deprecated. */
export const legacyPageQueryShape = {
  page: deprecated(coercedInt(1).optional(), '`cursor`'),
  pageSize: deprecated(coercedInt(1, MAX_PAGE_LIMIT).optional(), '`limit`'),
};

/** Legacy `offset` parameter, kept for existing clients and marked deprecated. */
export const legacyOffsetQueryShape = {
  offset: deprecated(coercedInt(0).optional(), '`cursor`'),
};

/**
 * What every list response carries next to its items. Each field is a shared
 * spec component (`PageHasMore`, `PageNextCursor`, `PageTotal`), so every list
 * payload references the same definitions while staying a closed object.
 */
export const pageInfoShape = {
  hasMore: z.boolean().meta({
    description: 'Whether another page follows this one.',
    id: 'PageHasMore',
  }),
  nextCursor: z.string().nullable().meta({
    description: 'Pass as `cursor` to fetch the next page; `null` on the last page.',
    id: 'PageNextCursor',
  }),
};

export const totalShape = {
  total: z.number().int().min(0).meta({
    description: 'Number of items across all pages.',
    id: 'PageTotal',
  }),
};

/**
 * Schema factory for a list payload: `{ [key]: T[], hasMore, nextCursor, total? }`.
 * New endpoints use the default `items` key.
 */
export const paginatedListSchema = <T extends z.ZodType, K extends string = 'items'>(
  item: T,
  { key = 'items' as K, total = false }: { key?: K; total?: boolean } = {},
) =>
  z
    .object({
      [key]: z.array(item),
      ...pageInfoShape,
      ...(total ? totalShape : {}),
    } as { [P in K]: z.ZodArray<T> } & typeof pageInfoShape & Partial<typeof totalShape>)
    .strict();

export interface PaginationRequest {
  cursor?: string;
  limit?: number;
  offset?: number;
  page?: number;
  pageSize?: number;
}

export interface ResolvedPagination {
  limit: number;
  offset: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Resolve any accepted pagination style to a bounded `limit`/`offset`:
 * `cursor` wins, then the deprecated `offset`, then the deprecated `page`.
 */
export const resolvePagination = (
  request: PaginationRequest,
  defaultLimit: number = DEFAULT_PAGE_LIMIT,
): ResolvedPagination => {
  const limit = clamp(request.limit ?? request.pageSize ?? defaultLimit, 1, MAX_PAGE_LIMIT);

  if (request.cursor) return { limit, offset: decodeOffsetCursor(request.cursor) };
  if (request.offset !== undefined) return { limit, offset: Math.max(0, request.offset) };

  return { limit, offset: (Math.max(1, request.page ?? 1) - 1) * limit };
};

export interface PageInfo {
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * `hasMore`/`nextCursor` for one offset-backed page. With a `total` the answer
 * is exact; without one, a full page is assumed to have a successor.
 */
export const buildPageInfo = ({
  limit,
  offset,
  returned,
  total,
}: ResolvedPagination & { returned: number; total?: number }): PageInfo => {
  const hasMore = total === undefined ? returned >= limit : offset + returned < total;
  return { hasMore, nextCursor: hasMore ? encodeOffsetCursor(offset + returned) : null };
};

/**
 * Process pagination query parameters
 * @param request Query parameter object
 * @returns a bounded limit/offset pair; omitted pagination defaults to page 1 / 20 items
 */
export function processPaginationConditions(
  request: Record<string, any> & IPaginationQuery & PaginationRequest,
): ResolvedPagination {
  return resolvePagination(request);
}
