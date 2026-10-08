/**
 * First-class pagination for replicas.
 *
 * Vocabulary (direction-agnostic):
 * - HEAD page: the newest window, what a refresh re-fetches (`cursor` undefined).
 * - NEXT pages: further pages in the paging direction (older history).
 *   - `forward`: the view is head-first, next pages append at the END
 *     (sidebar lists: newest topic first, "load more" below).
 *   - `backward`: the view is oldest-first, next pages PREPEND at the start
 *     (chat transcripts: newest message last, "load older" on scroll-up).
 * - `offset` mode: the cursor is the page index (0 = head).
 *   `cursor` mode: the server hands back an opaque `nextCursor`.
 *
 * Every function is pure; the store binding owns staleness and scope.
 */

export type ReplicaPagingMode = 'cursor' | 'offset';
export type ReplicaPagingDirection = 'backward' | 'forward';

export interface ReplicaPagingConfig<TItem, TCursor = any> {
  /**
   * Cursor mode: cursor to the page past `item`, the last cursor-eligible row
   * on the far side, for a server that pages by row but reports no
   * `nextCursor` (a plain list). Only safe when the row carries a lossless
   * position; omit it when the server owns the cursor, and paging then waits
   * for one.
   */
  deriveCursor?: (item: TItem) => TCursor;
  direction: ReplicaPagingDirection;
  getId: (item: TItem) => string;
  /**
   * Rows that may anchor a join or derive a cursor. Synthetic rows the query
   * injects (group / summary nodes) have no position of their own on the
   * server, so they are skipped. Defaults to every row.
   */
  isCursorable?: (item: TItem) => boolean;
  mode: ReplicaPagingMode;
  /** Which part survives a reload. Defaults to the head page only. */
  persist?: {
    /** Hard cap on persisted items (taken from the head side). */
    maxItems?: number;
    /** Number of pages from the head side. Default 1. */
    pages?: number;
  };
  /**
   * Optional total order re-applied after every merge (e.g. messages by
   * createdAt). The sort is stable: rows the comparator ties keep the order
   * the server sent them in, so compare positions only — an id tie-break
   * would reorder rows created within the same tick.
   */
  sort?: (a: TItem, b: TItem) => number;
}

export interface ReplicaPageResult<TItem, TCursor> {
  items: TItem[];
  /** Cursor mode: next page cursor; `null` = exhausted, `undefined` = unknown. */
  nextCursor?: TCursor | null;
  total?: number;
}

export interface ReplicaPageInfo<TCursor> {
  /** Items this page contributed after de-duplication. */
  count: number;
  /** Cursor of the page after this one; `null` = exhausted, `undefined` = unknown. */
  next?: TCursor | null;
}

/**
 * The paged view a resource keeps in the store. Domain views extend it, so
 * selectors read `items` / `hasMore` / `isLoadingMore` as before.
 */
export interface ReplicaPagedData<TItem, TCursor = number> {
  /**
   * Boundary row of the head page once more pages are loaded (forward: its
   * last row, backward: its first row). A refreshed head page that no longer
   * contains it has slid past the loaded pages — merging would hide a gap.
   */
  anchorId?: string;
  /** Index of the last merged page (0 = head only). */
  currentPage: number;
  hasMore: boolean;
  /**
   * Synthetic (non-cursorable) rows of the head page. A sort can place them
   * among older pages, so a head refresh drops them by id rather than by
   * position — the fresh head brings its own.
   */
  headSyntheticIds?: string[];
  isLoadingMore?: boolean;
  items: TItem[];
  loadMoreError?: unknown;
  /** Cursor for the next page (offset: page index). `null` = exhausted. */
  nextCursor?: TCursor | null;
  /** Per-page bookkeeping, head first. Missing on legacy data = one page. */
  pages?: ReplicaPageInfo<TCursor>[];
  pageSize: number;
  total?: number;
}

export interface ReplicaPagingContext<TItem> {
  /**
   * Client-only rows (optimistic inserts whose server row may not exist yet).
   * They survive head refreshes and are never persisted.
   */
  isClientOnly?: (item: TItem) => boolean;
}

const dedupe = <TItem>(
  items: TItem[],
  getId: (item: TItem) => string,
  seen = new Set<string>(),
) => {
  const out: TItem[] = [];
  for (const item of items) {
    const id = getId(item);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
};

const ordered = <TItem>(items: TItem[], config: ReplicaPagingConfig<TItem>) =>
  config.sort ? [...items].sort(config.sort) : items;

/** Concatenate in view order: forward = head first, backward = head last. */
const join = <TItem>(head: TItem[], rest: TItem[], direction: ReplicaPagingDirection) =>
  direction === 'forward' ? [...head, ...rest] : [...rest, ...head];

const deriveHasMore = <TItem, TCursor>(
  data: Pick<ReplicaPagedData<TItem, TCursor>, 'items' | 'nextCursor' | 'total'>,
  serverCount: number,
) => (data.total !== undefined ? data.total > serverCount : data.nextCursor !== null);

const offsetNext = (more: boolean, nextIndex: number) => (more ? nextIndex : null);

/**
 * Cursor to request the next page with; `null` → exhausted, `undefined` →
 * cannot page yet. Offset views without bookkeeping (seeded by legacy code or
 * an older persisted shape) derive it from `currentPage` / `hasMore`.
 */
export const getNextPageCursor = <TItem, TCursor>(
  data: ReplicaPagedData<TItem, TCursor> | undefined,
  config: Pick<
    ReplicaPagingConfig<TItem, TCursor>,
    'deriveCursor' | 'direction' | 'isCursorable' | 'mode'
  >,
): TCursor | null | undefined => {
  if (!data) return undefined;
  if (data.nextCursor !== undefined) return data.nextCursor;
  if (config.mode === 'offset')
    return (data.hasMore ? (data.currentPage ?? 0) + 1 : null) as TCursor | null;
  if (!config.deriveCursor || !data.hasMore) return undefined;
  const boundary = farBoundary(data.items, config);
  return boundary === undefined ? undefined : config.deriveCursor(boundary);
};

/**
 * The boundary row on the far side of `items` (forward: last, backward: first)
 * that may anchor a join or derive a cursor.
 */
const farBoundary = <TItem>(
  items: TItem[],
  config: Pick<ReplicaPagingConfig<TItem>, 'direction' | 'isCursorable'>,
): TItem | undefined => {
  const eligible = config.isCursorable ?? (() => true);
  if (config.direction === 'forward') return items.findLast((item) => eligible(item));
  return items.find((item) => eligible(item));
};

const syntheticIds = <TItem>(
  items: TItem[],
  config: Pick<ReplicaPagingConfig<TItem>, 'getId' | 'isCursorable'>,
): string[] | undefined => {
  if (!config.isCursorable) return undefined;
  const ids = items.filter((item) => !config.isCursorable!(item)).map(config.getId);
  return ids.length ? ids : undefined;
};

const splitClientOnly = <TItem>(items: TItem[], ctx: ReplicaPagingContext<TItem>) => {
  if (!ctx.isClientOnly) return { clientOnly: [] as TItem[], server: items };
  const clientOnly: TItem[] = [];
  const server: TItem[] = [];
  for (const item of items) (ctx.isClientOnly(item) ? clientOnly : server).push(item);
  return { clientOnly, server };
};

/**
 * Fold a fresh HEAD page into the view.
 *
 * - First load, a query change (`reset`) or an unextended view → the head page.
 * - Extended view, `offset` mode → keep the loaded depth: fresh head first,
 *   then previously loaded rows not in it (shifted offsets self-heal by id).
 * - Extended view, `cursor` mode → keep older pages only when the fresh head
 *   still contains the join anchor and the next cursor is known; otherwise
 *   collapse to the head page (never show a hidden gap).
 *
 * Client-only rows still in the view are kept on the head side.
 */
export const applyHeadPage = <TItem, TCursor>(
  current: ReplicaPagedData<TItem, TCursor> | undefined,
  page: ReplicaPageResult<TItem, TCursor>,
  options: { pageSize: number; reset?: boolean },
  config: ReplicaPagingConfig<TItem, TCursor>,
  ctx: ReplicaPagingContext<TItem> = {},
): ReplicaPagedData<TItem, TCursor> => {
  const { getId, direction } = config;
  const fresh = dedupe(page.items, getId);
  const freshIds = new Set(fresh.map(getId));
  const { clientOnly, server: currentServer } = splitClientOnly(current?.items ?? [], ctx);
  const survivors = clientOnly.filter((item) => !freshIds.has(getId(item)));
  const total = page.total ?? (options.reset ? undefined : current?.total);
  // Client-only rows are the newest: they sit at the very head of the view.
  const headItems = direction === 'forward' ? [...survivors, ...fresh] : [...fresh, ...survivors];

  const headOnly = (): ReplicaPagedData<TItem, TCursor> => {
    const nextCursor =
      config.mode === 'offset'
        ? (offsetNext(
            total !== undefined ? total > fresh.length : fresh.length >= options.pageSize,
            1,
          ) as TCursor | null)
        : page.nextCursor;
    const data = {
      anchorId: undefined,
      currentPage: 0,
      headSyntheticIds: syntheticIds(fresh, config),
      items: ordered(headItems, config),
      nextCursor,
      pageSize: options.pageSize,
      pages: [{ count: fresh.length, next: nextCursor }],
      total,
    };
    return {
      ...data,
      hasMore: deriveHasMore(data, fresh.length),
      isLoadingMore: current?.isLoadingMore,
      // A fresh head page supersedes the last page failure.
      loadMoreError: undefined,
    };
  };

  const extended = !!current && current.currentPage > 0 && !options.reset;
  // A cursor walk keys pages by position, so a head page of another length
  // (round-trimmed windows vary on every refresh) still joins by its anchor.
  if (!extended || (config.mode === 'offset' && current.pageSize !== options.pageSize))
    return headOnly();

  let rest: TItem[];
  let anchorId: string | undefined;
  if (config.mode === 'offset') {
    const restCandidates = currentServer.filter((item) => !freshIds.has(getId(item)));
    // Keep the depth the user scrolled to, bounded by what still exists.
    const visible = Math.min(currentServer.length, total ?? Number.POSITIVE_INFINITY);
    const keep = Math.max(0, visible - fresh.length);
    rest =
      direction === 'forward'
        ? restCandidates.slice(0, keep)
        : restCandidates.slice(Math.max(0, restCandidates.length - keep));
  } else {
    const anchorIndex = current.anchorId
      ? currentServer.findIndex((item) => getId(item) === current.anchorId)
      : -1;
    // Without a known next cursor the loaded pages can only be kept when the
    // cursor is derivable from the rows themselves.
    const cursorKnown = current.nextCursor !== undefined || !!config.deriveCursor;
    if (anchorIndex === -1 || !freshIds.has(current.anchorId!) || !cursorKnown) return headOnly();
    const farSide =
      direction === 'forward'
        ? currentServer.slice(anchorIndex + 1)
        : currentServer.slice(0, anchorIndex);
    const staleHead = new Set(current.headSyntheticIds);
    rest = farSide.filter((item) => !freshIds.has(getId(item)) && !staleHead.has(getId(item)));
    const boundary = farBoundary(fresh, config);
    anchorId = boundary ? getId(boundary) : current.anchorId;
  }

  const headNext = config.mode === 'cursor' ? page.nextCursor : current.pages?.[0]?.next;
  const pages = current.pages?.length
    ? [{ count: fresh.length, next: headNext }, ...current.pages.slice(1)]
    : [{ count: fresh.length, next: headNext }];
  const data = {
    anchorId: anchorId ?? current.anchorId,
    currentPage: current.currentPage,
    headSyntheticIds: syntheticIds(fresh, config),
    items: ordered(join(headItems, rest, direction), config),
    nextCursor: current.nextCursor,
    pageSize: options.pageSize,
    pages,
    total,
  };
  return {
    ...data,
    hasMore: deriveHasMore(data, fresh.length + rest.length),
    isLoadingMore: current.isLoadingMore,
    loadMoreError: undefined,
  };
};

/** Merge the NEXT page (fetched with `getNextPageCursor`) into the view. */
export const applyNextPage = <TItem, TCursor>(
  current: ReplicaPagedData<TItem, TCursor>,
  page: ReplicaPageResult<TItem, TCursor>,
  config: ReplicaPagingConfig<TItem, TCursor>,
  ctx: ReplicaPagingContext<TItem> = {},
): ReplicaPagedData<TItem, TCursor> => {
  const { getId, direction } = config;
  const seen = new Set(current.items.map(getId));
  const added = dedupe(page.items, getId, seen);
  const total = page.total ?? current.total;
  const serverCount = splitClientOnly(current.items, ctx).server.length + added.length;

  let next: TCursor | null | undefined;
  if (config.mode === 'offset') {
    const more = total !== undefined ? total > serverCount : page.items.length >= current.pageSize;
    next = offsetNext(more, current.currentPage + 2) as TCursor | null;
  } else {
    // Only an empty page marks the end when the server reports no cursor.
    next = page.items.length === 0 ? null : page.nextCursor;
  }

  // The first extension pins the join anchor at the head page's boundary.
  let anchorId = current.anchorId;
  if (current.currentPage === 0) {
    const boundary = farBoundary(splitClientOnly(current.items, ctx).server, config);
    anchorId = boundary ? getId(boundary) : undefined;
  }

  const items = ordered(
    direction === 'forward' ? [...current.items, ...added] : [...added, ...current.items],
    config,
  );
  const data = {
    ...current,
    anchorId,
    currentPage: current.currentPage + 1,
    isLoadingMore: false,
    items,
    loadMoreError: undefined,
    nextCursor: next,
    pages: [
      ...(current.pages?.length ? current.pages : [{ count: current.items.length }]),
      { count: added.length, next },
    ],
    total,
  };
  return { ...data, hasMore: deriveHasMore(data, serverCount) };
};

/**
 * Insert new rows on the HEAD side (a streamed message, a created topic).
 * Cursors point at the far end, so they stay valid; offsets shift and are
 * healed by id de-duplication on the next page merge.
 */
export const insertHeadItems = <TItem, TCursor>(
  current: ReplicaPagedData<TItem, TCursor>,
  items: TItem[],
  config: ReplicaPagingConfig<TItem, TCursor>,
): ReplicaPagedData<TItem, TCursor> => {
  const seen = new Set(current.items.map(config.getId));
  const added = dedupe(items, config.getId, seen);
  if (added.length === 0) return current;
  const pages = current.pages?.length ? current.pages : [{ count: current.items.length }];
  return {
    ...current,
    items: ordered(join(added, current.items, config.direction), config),
    pages: [{ ...pages[0], count: pages[0].count + added.length }, ...pages.slice(1)],
    total: current.total === undefined ? undefined : current.total + added.length,
  };
};

/**
 * Patch (or remove, when `fn` returns `undefined`) one row by id. Returns the
 * same reference when the row is absent or unchanged.
 */
export const mapPagedItem = <TItem, TCursor, TData extends ReplicaPagedData<TItem, TCursor>>(
  current: TData,
  id: string,
  fn: (item: TItem) => TItem | undefined,
  config: Pick<ReplicaPagingConfig<TItem>, 'getId'>,
): TData => {
  const index = current.items.findIndex((item) => config.getId(item) === id);
  if (index === -1) return current;
  const next = fn(current.items[index]);
  if (next === current.items[index]) return current;
  if (next !== undefined) {
    const items = [...current.items];
    items[index] = next;
    return { ...current, items };
  }
  const items = current.items.filter((_, i) => i !== index);
  const total = current.total === undefined ? undefined : Math.max(items.length, current.total - 1);
  return {
    ...current,
    hasMore: total !== undefined ? total > items.length : current.hasMore,
    items,
    total,
  };
};

/** Whether a paged view holds a row. */
export const hasPagedItem = <TItem>(
  data: ReplicaPagedData<TItem, unknown> | undefined,
  id: string,
  config: Pick<ReplicaPagingConfig<TItem>, 'getId'>,
) => !!data?.items.some((item) => config.getId(item) === id);

/** Select head-side rows without losing synthetic head rows sorted among older pages. */
const takeHeadItems = <TItem, TCursor>(
  items: TItem[],
  count: number,
  data: ReplicaPagedData<TItem, TCursor>,
  config: ReplicaPagingConfig<TItem, TCursor>,
): TItem[] => {
  if (count === 0) return [];
  const synthetic = new Set(data.headSyntheticIds);
  const syntheticCount = items.filter((item) => synthetic.has(config.getId(item))).length;
  const regular = items.filter((item) => !synthetic.has(config.getId(item)));
  const regularCount = Math.max(0, count - syntheticCount);
  const selected =
    config.direction === 'forward'
      ? regular.slice(0, regularCount)
      : regular.slice(Math.max(0, regular.length - regularCount));
  const ids = new Set(selected.map(config.getId));
  return items
    .filter((item) => synthetic.has(config.getId(item)) || ids.has(config.getId(item)))
    .slice(
      config.direction === 'forward' ? 0 : -count,
      config.direction === 'forward' ? count : undefined,
    );
};

/** Drop every loaded page but the head (e.g. after an edit inside older history). */
export const collapseToHead = <TItem, TCursor>(
  current: ReplicaPagedData<TItem, TCursor>,
  config: ReplicaPagingConfig<TItem, TCursor>,
): ReplicaPagedData<TItem, TCursor> => {
  if (current.currentPage === 0) return current;
  const head = current.pages?.[0];
  const count = head?.count ?? current.pageSize;
  const items = takeHeadItems(current.items, count, current, config);
  const nextCursor = config.mode === 'offset' ? (1 as TCursor) : (head?.next ?? undefined);
  return {
    ...current,
    anchorId: undefined,
    currentPage: 0,
    hasMore: true,
    items,
    nextCursor,
    pages: [{ count: items.length, next: nextCursor }],
  };
};

/**
 * What survives a reload: whole pages from the head side, bounded by
 * `persist.pages` and `persist.maxItems`, client-only rows and transient
 * flags stripped. Offset views are cut at page-size boundaries so the
 * persisted `currentPage` stays a valid offset; a cut inside a cursor page
 * forgets the cursor (pagination resumes after the next server head page).
 */
export const toPersistedPage = <TItem, TCursor, TData extends ReplicaPagedData<TItem, TCursor>>(
  data: TData,
  config: ReplicaPagingConfig<TItem, TCursor>,
  ctx: ReplicaPagingContext<TItem> = {},
): TData => {
  const { server } = splitClientOnly(data.items, ctx);
  const pageLimit = Math.max(1, config.persist?.pages ?? 1);
  const maxItems = config.persist?.maxItems ?? Number.POSITIVE_INFINITY;
  const pages = data.pages?.length ? data.pages : [{ count: server.length, next: data.nextCursor }];

  let count = 0;
  let keptPages = 0;
  let aligned = true;
  if (config.mode === 'offset') {
    const loadedPages = Math.min(pageLimit, data.currentPage + 1);
    const byItems = Math.floor(maxItems / Math.max(1, data.pageSize));
    keptPages = Math.max(1, Math.min(loadedPages, byItems || 1));
    count = Math.min(server.length, keptPages * data.pageSize, maxItems);
  } else {
    for (const page of pages.slice(0, pageLimit)) {
      if (count + page.count > maxItems) {
        aligned = false;
        count = keptPages === 0 ? Math.min(page.count, maxItems) : count;
        if (keptPages === 0) keptPages = 1;
        break;
      }
      count += page.count;
      keptPages += 1;
    }
    count = Math.min(count, server.length);
  }

  const items = takeHeadItems(server, count, data, config);
  const lastKept = pages[keptPages - 1];
  const nextCursor =
    config.mode === 'offset'
      ? ((count < (data.total ?? server.length) ? keptPages : null) as TCursor | null)
      : aligned
        ? lastKept?.next
        : undefined;

  const {
    isLoadingMore: _loading,
    loadMoreError: _error,
    ...rest
  } = data as ReplicaPagedData<TItem, TCursor>;
  return {
    ...rest,
    anchorId: keptPages > 1 ? data.anchorId : undefined,
    currentPage: keptPages - 1,
    hasMore: data.total !== undefined ? data.total > items.length : nextCursor !== null,
    items,
    nextCursor,
    pages: [
      ...pages.slice(0, keptPages - 1),
      {
        count: Math.max(
          0,
          items.length - pages.slice(0, keptPages - 1).reduce((sum, page) => sum + page.count, 0),
        ),
        next: nextCursor,
      },
    ],
  } as unknown as TData;
};
