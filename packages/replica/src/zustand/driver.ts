/**
 * Scheduling knobs a sync can ask its driver for. Named after SWR's options;
 * a driver maps them onto its own cache (or ignores what it cannot honor).
 */
export interface ReplicaSyncSchedule {
  /** Collapse identical requests within this window (ms). */
  dedupingInterval?: number;
  /** Skip focus revalidation while the last one is younger than this (ms). */
  focusThrottleInterval?: number;
  /**
   * Hold every network request (mount, stale, focus, revalidate) while it
   * returns `true`, for a read whose input outside the sync key is not ready
   * yet. Unlike `revalidateOnMount: false` it also covers a later key change.
   * Read on each request, so it may close over a ref.
   */
  isPaused?: () => boolean;
  /** Poll every N ms while mounted (0 = off); a function decides per tick from the latest data. */
  refreshInterval?: number | ((latest: any) => number);
  /** Keep polling while the page is hidden. */
  refreshWhenHidden?: boolean;
  /** Keep polling while the browser is offline. */
  refreshWhenOffline?: boolean;
  revalidateIfStale?: boolean;
  revalidateOnFocus?: boolean;
  /**
   * Whether the first mount fetches. `false` leaves the first request to an
   * explicit `revalidate`, for a read whose input outside the sync key is not
   * ready yet. SWR only honors it on the first mount: a later key change still
   * fetches when the new key has no cached data.
   */
  revalidateOnMount?: boolean;
  revalidateOnReconnect?: boolean;
}

export interface ReplicaQueryOptions<T> extends ReplicaSyncSchedule {
  /** Run once per key: no refetch on focus, reconnect or remount (hydration reads). */
  once?: boolean;
  onError?: (error: unknown) => void;
  onSuccess?: (data: T) => void;
}

export interface ReplicaQueryResult<T> {
  data?: T;
  error?: unknown;
  isValidating: boolean;
  /** Re-run this query. */
  mutate: () => Promise<unknown>;
}

/**
 * The query cache that schedules a replica's fetches: dedupe, focus /
 * reconnect revalidation, retries. The replica decides what a response means;
 * the driver only decides when to ask. `createSWRDriver` adapts SWR.
 */
export interface ReplicaSyncDriver {
  /** Re-run every mounted query whose key matches. */
  revalidate: (match: (key: unknown) => boolean) => Promise<unknown>;
  /**
   * Write a head response that `slice.fetch` requested outside `useQuery` into
   * the query cache under its sync key, without re-running the query — so a
   * `useQuery` of that key sees the latest data (a `revalidateIfStale: false`
   * mount does not refetch it). Optional: a driver without a cache of its own
   * leaves it out; requests still dedupe in the slice.
   *
   * The slice calls it only while no `useQuery` request of the key is in
   * flight. A cache that discards in-flight requests a write overtakes (SWR
   * does) would otherwise drop a newer response than the one written.
   */
  seed?: (key: readonly unknown[], data: unknown) => void;
  useQuery: <T>(
    key: readonly unknown[] | null,
    fetcher: () => Promise<T>,
    options: ReplicaQueryOptions<T>,
  ) => ReplicaQueryResult<T>;
}

type SWRLikeHook = (
  key: any,
  fetcher: any,
  config?: any,
) => { data?: any; error?: unknown; isValidating: boolean; mutate: () => Promise<any> };

/**
 * Driver over SWR. Pass the app's own hook and scoped `mutate` when it wraps
 * SWR (custom cache provider, key augmentation, retry policy).
 */
export const createSWRDriver = ({
  mutate,
  useSWR,
}: {
  /**
   * SWR's (scoped) `mutate`. Called as `mutate(match)` to revalidate, and as
   * `mutate(key, data, { revalidate: false })` to seed — pass the arguments
   * through unchanged: SWR tells a revalidation from a write by their count.
   */
  mutate: (
    ...args: [match: (key: any) => boolean] | [key: unknown, data: unknown, options: object]
  ) => Promise<unknown>;
  useSWR: SWRLikeHook;
}): ReplicaSyncDriver => ({
  revalidate: (match) => mutate(match),
  // Populate the cache only: re-running the query would refetch what was just fetched.
  seed: (key, data) => {
    void mutate(key, data, { revalidate: false }).catch(() => undefined);
  },
  useQuery: (key, fetcher, { once, onError, onSuccess, ...schedule }) =>
    useSWR(key, fetcher, {
      ...Object.fromEntries(Object.entries(schedule).filter(([, value]) => value !== undefined)),
      ...(once && {
        revalidateIfStale: false,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
      }),
      ...(onError && { onError: (error: unknown) => onError(error) }),
      ...(onSuccess && { onSuccess: (data: unknown) => onSuccess(data as never) }),
    }),
});
