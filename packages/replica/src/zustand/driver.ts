/**
 * Scheduling knobs a sync can ask its driver for. Named after SWR's options;
 * a driver maps them onto its own cache (or ignores what it cannot honor).
 */
export interface ReplicaSyncSchedule {
  /** Collapse identical requests within this window (ms). */
  dedupingInterval?: number;
  /** Skip focus revalidation while the last one is younger than this (ms). */
  focusThrottleInterval?: number;
  /** Poll every N ms while mounted (0 = off); a function decides per tick from the latest data. */
  refreshInterval?: number | ((latest: any) => number);
  /** Keep polling while the page is hidden. */
  refreshWhenHidden?: boolean;
  /** Keep polling while the browser is offline. */
  refreshWhenOffline?: boolean;
  revalidateIfStale?: boolean;
  revalidateOnFocus?: boolean;
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
  mutate: (match: (key: any) => boolean) => Promise<unknown>;
  useSWR: SWRLikeHook;
}): ReplicaSyncDriver => ({
  revalidate: (match) => mutate(match),
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
