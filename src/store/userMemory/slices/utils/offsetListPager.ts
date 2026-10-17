import { type ReplicaOptimisticToken, type ReplicaPagedData } from '@/libs/replica';

/** The part of a paged replica slice the pager drives (structural, so any slice fits). */
export interface OffsetPagedSlice {
  beginEntityOptimistic: <TItem>(
    id: string,
    fn: (item: TItem) => TItem | undefined,
  ) => ReplicaOptimisticToken<any>[];
  collapse: (key: string) => unknown;
  loadMore: (key: string) => Promise<void>;
  /** `scope` routes a removal confirmed after an account switch to the scope that asked. */
  removeEntity: (id: string, options?: { scope?: string }) => void;
  update: (key: string, apply: (data: any) => any, options?: { persist?: boolean }) => unknown;
}

interface OffsetListPagerOptions {
  /** Entry keys loaded in memory (every page set a delete may have shifted). */
  keys: () => string[];
  /** The loaded page set of one entry (`undefined` = not loaded). */
  read: (key: string) => ReplicaPagedData<unknown, unknown> | undefined;
  /**
   * Re-read the head page of the mounted query through the list's own SWR key
   * (the awaitable bare `mutate(matcher)` form). Resolves once the refetch
   * settled, whether or not it succeeded.
   */
  refreshHead: () => Promise<unknown>;
  /** The list resource's active scope (the user the store shows). */
  scope: () => string;
  slice: OffsetPagedSlice;
}

/**
 * A delete that waited behind other paging work and found another account
 * active when its turn came. It was not sent: the server call would run with
 * the new account's credentials. The optimistic removal is rolled back.
 */
export class MemoryDeleteScopeChangedError extends Error {
  constructor() {
    super('The account changed before the delete could be sent');
    this.name = 'MemoryDeleteScopeChangedError';
  }
}

/** Shown on the footer when the head could not be refreshed and no request error is known. */
const staleHeadError = () => new Error('Failed to refresh the list before loading more');

/**
 * Delete / "load more" / purge for an offset-paged memory list.
 *
 * The memory lists page by offset (cursor = page index), so a server-side
 * delete shifts every later row one slot up: the next page asked for with the
 * loaded cursor would skip the row that crossed the page boundary. The pager
 * repairs that the same way for every list:
 *
 * - **Delete**: the row leaves every loaded page set at once (optimistic, rolled
 *   back if the server rejects). Once the server confirms, `removeEntity` drops
 *   it from persisted rows too, every loaded page set collapses to its head
 *   and is marked *head-stale*, and the head is refreshed.
 * - **Head-stale guard**: "load more" on a head-stale page set — marked by a
 *   delete in this session, or *short* (fewer rows than its loaded pages hold,
 *   e.g. a persisted variant the delete patched and a later visit hydrated) —
 *   first refreshes the head; it only fetches the next page once a fresh head landed
 *   (`headLanded`). If the refresh fails, the footer shows the failure with a
 *   retry instead of paging from a stale offset.
 * - **Serialization**: deletes, pages and the purge run one after another, so
 *   load-more waits for an in-flight delete + refresh, a delete waits for a
 *   page already in flight (its offset predates the shift), and a purge never
 *   races a page that would land into the emptied list.
 */
export class OffsetListPager {
  readonly #headErrors = new Map<string, unknown>();
  readonly #keys: () => string[];
  readonly #loadingMore = new Map<string, Promise<void>>();
  readonly #read: OffsetListPagerOptions['read'];
  readonly #refreshHead: () => Promise<unknown>;
  readonly #scope: () => string;
  readonly #slice: OffsetPagedSlice;
  readonly #staleHeads = new Set<string>();
  /** Serialized paging work not settled yet. */
  #inFlight = 0;
  /** Tail of the serialized paging work. */
  #tail: Promise<unknown> = Promise.resolve();

  constructor({ keys, read, refreshHead, scope, slice }: OffsetListPagerOptions) {
    this.#scope = scope;
    this.#keys = keys;
    this.#read = read;
    this.#refreshHead = refreshHead;
    this.#slice = slice;
  }

  #serialize = <T>(work: () => Promise<T>): Promise<T> => {
    this.#inFlight++;
    const run = this.#tail.then(work).finally(() => {
      this.#inFlight--;
    });
    this.#tail = run.catch(() => undefined);
    return run;
  };

  /**
   * Whether a page set lost rows under its loaded offsets: it still has more
   * to load, yet holds fewer rows than its loaded pages hold on the server. A
   * delete patches every persisted query variant (`removeEntity`), including
   * ones this session never loaded — or a delete in an earlier session did — so
   * a page set hydrated later can be short without this session having marked
   * it. Its next offset would skip the row that shifted into its last page.
   */
  #isShort = (key: string): boolean => {
    const data = this.#read(key);
    if (!data?.hasMore) return false;
    return data.items.length < (data.currentPage + 1) * data.pageSize;
  };

  /** Whether `key` must refresh its head before paging again. */
  isHeadStale = (key: string): boolean => this.#staleHeads.has(key) || this.#isShort(key);

  /** A head page of `key` landed: its offsets are the server's again. */
  headLanded = (key: string): void => {
    this.#staleHeads.delete(key);
    this.#headErrors.delete(key);
  };

  /**
   * The `useSync` callbacks of `key`'s head request. A failure captured under
   * another identity / workspace (`isActive: false` — a request of the previous
   * account settling after a switch) is not this page set's: query keys repeat
   * across users, so recording it would surface the previous user's error on
   * the new user's footer.
   */
  syncCallbacks = (key: string) => ({
    onError: (error: unknown, context?: { isActive?: boolean }) => {
      if (context?.isActive === false) return;
      this.headFailed(key, error);
    },
    // A landed head makes this page set's offsets the server's again.
    onSuccess: () => this.headLanded(key),
  });

  /** The head request of `key` failed (surfaced if paging is blocked on it). */
  headFailed = (key: string, error: unknown): void => {
    this.#headErrors.set(key, error);
  };

  /**
   * Delete one row (see the class doc). Rejects with the server error after
   * rolling the optimistic removal back.
   */
  delete = (id: string, serverCall: () => Promise<unknown>): Promise<void> => {
    // The account that asks for the delete. If another one is active once the
    // server confirms, the removal belongs to this one's persisted rows only.
    const scope = this.#scope();
    const tokens = this.#slice.beginEntityOptimistic(id, () => undefined);

    return this.#serialize(async () => {
      // Queued behind a page or another delete: by the time it runs, another
      // account may be active. Never send it under that account's credentials.
      if (this.#scope() !== scope) {
        for (const token of tokens) token.rollback();
        throw new MemoryDeleteScopeChangedError();
      }
      try {
        await serverCall();
      } catch (error) {
        for (const token of tokens) token.rollback();
        throw error;
      }
      for (const token of tokens) token.commit();

      if (this.#scope() !== scope) {
        // Account switched meanwhile: drop the row from the requesting account's
        // persisted query rows (and guard its hydrates). The page sets on screen
        // belong to the other account — no collapse, no head refresh for them.
        this.#slice.removeEntity(id, { scope });
        return;
      }

      // Drop the row from every loaded and persisted page set, and keep a read
      // already in flight from bringing it back.
      this.#slice.removeEntity(id);
      for (const key of this.#keys()) {
        this.#staleHeads.add(key);
        this.#slice.collapse(key);
      }
      await this.#refreshHead();
    });
  };

  /** Append the next page of `key` once its head is trustworthy. Concurrent calls share one run. */
  loadMore = (key: string): Promise<void> => {
    const running = this.#loadingMore.get(key);
    if (running) return running;

    const run = this.#serialize(async () => {
      if (this.isHeadStale(key)) {
        this.#staleHeads.add(key);
        await this.#refreshHead();
        if (this.#staleHeads.has(key)) {
          const error = this.#headErrors.get(key) ?? staleHeadError();
          this.#slice.update(
            key,
            (data) => data && { ...data, isLoadingMore: false, loadMoreError: error },
            { persist: false },
          );
          return;
        }
      }
      await this.#slice.loadMore(key);
    }).finally(() => this.#loadingMore.delete(key));

    this.#loadingMore.set(key, run);
    return run;
  };

  /**
   * Run the list's purge now — the view empties at once — and, when a page or
   * a delete is still in flight, once more after it settled, so nothing it
   * brings back survives. Nothing is head-stale afterwards.
   */
  clear = (clear: () => Promise<boolean>): Promise<boolean> => {
    this.#staleHeads.clear();
    this.#headErrors.clear();
    const now = clear();
    if (this.#inFlight === 0) return now;

    return this.#serialize(async () => {
      await now.catch(() => false);
      this.#staleHeads.clear();
      this.#headErrors.clear();
      return clear();
    });
  };
}
