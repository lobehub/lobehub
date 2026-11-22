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
): AsyncGenerator<PageItem<PageOf<M>>> {
  const base = (options ?? {}) as { query?: Record<string, unknown> };
  let cursor = base.query?.cursor as string | undefined;

  while (true) {
    const { data } = await method({
      ...base,
      client,
      query: { ...base.query, ...(cursor ? { cursor } : {}) },
      // The loop reads the envelope's `data`: a client configured for
      // data-only results must not strip it here.
      responseStyle: 'fields',
      throwOnError: true,
    });
    const page = (data as { data: PageShape & Record<string, unknown> }).data;
    for (const item of pageItems(page)) yield item as PageItem<PageOf<M>>;

    if (!page.hasMore || !page.nextCursor || page.nextCursor === cursor) return;
    cursor = page.nextCursor;
  }
}
