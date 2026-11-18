import type { Client } from './generated/client';

/** The page shape every list endpoint answers with inside `data`. */
interface PageShape {
  hasMore: boolean;
  nextCursor: string | null;
}

type AnyFn = (options: any) => Promise<any>;

/** `data` of the success envelope for a list method. */
export type PageOf<M extends AnyFn> =
  NonNullable<Awaited<ReturnType<M>>['data']> extends { data: infer Page } ? Page : never;

/** Items of a page: the `items` array, or the endpoint's own array key (`agents`, `topics`, …). */
export type PageItem<P> = P extends { items: Array<infer I> }
  ? I
  : { [K in keyof P]: P[K] extends Array<infer I> ? I : never }[keyof P];

export type PaginateOptions<M extends AnyFn> = NonNullable<Parameters<M>[0]>;

export interface PaginateLimits {
  /**
   * Stop after this many items. Each request then asks for no more than the
   * items still wanted (`query.limit` caps the page size), so a "first N"
   * read never fetches a full page it throws away.
   */
  maxItems?: number;
}

const PAGE_FIELDS = new Set(['hasMore', 'nextCursor', 'total', 'totalSize']);

/** Find the item array on a page: `items` first, else the one array-valued key. */
export const pageItems = (page: Record<string, unknown>): unknown[] => {
  if (Array.isArray(page.items)) return page.items;
  const arrays = Object.entries(page).filter(
    ([key, value]) => !PAGE_FIELDS.has(key) && Array.isArray(value),
  );
  if (arrays.length !== 1) {
    throw new Error(
      `paginate: cannot tell the item array apart on a page with keys ${Object.keys(page).join(', ')}`,
    );
  }
  return arrays[0][1] as unknown[];
};

/**
 * Walk every page of a cursor-paginated list, yielding its items: pass
 * `nextCursor` back as `cursor` until `hasMore` is false or `nextCursor` null.
 *
 * `method` may be passed unbound (`lobehub.agents.list`): the call carries the
 * client explicitly.
 */
export async function* paginate<M extends AnyFn>(
  client: Client,
  method: M,
  options?: PaginateOptions<M>,
  { maxItems }: PaginateLimits = {},
): AsyncGenerator<PageItem<PageOf<M>>> {
  const base = (options ?? {}) as { query?: Record<string, unknown> };
  let cursor = base.query?.cursor as string | undefined;
  const pageLimit = base.query?.limit as number | undefined;
  let remaining = maxItems ?? Number.POSITIVE_INFINITY;
  if (remaining <= 0) return;

  while (true) {
    const limit = Number.isFinite(remaining)
      ? Math.min(pageLimit ?? remaining, remaining)
      : pageLimit;
    const { data } = await method({
      ...base,
      client,
      query: {
        ...base.query,
        ...(cursor ? { cursor } : {}),
        ...(limit === undefined ? {} : { limit }),
      },
      throwOnError: true,
    });
    const page = (data as { data: PageShape & Record<string, unknown> }).data;
    for (const item of pageItems(page)) {
      yield item as PageItem<PageOf<M>>;
      if (--remaining <= 0) return;
    }

    if (!page.hasMore || !page.nextCursor || page.nextCursor === cursor) return;
    cursor = page.nextCursor;
  }
}
