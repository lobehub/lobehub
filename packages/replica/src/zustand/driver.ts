export interface ReplicaQueryOptions<T> {
  /** Run once per key: no refetch on focus, reconnect or remount (hydration reads). */
  once?: boolean;
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
  useQuery: (key, fetcher, { once, onSuccess }) =>
    useSWR(key, fetcher, {
      ...(once && {
        revalidateIfStale: false,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
      }),
      ...(onSuccess && { onSuccess: (data: unknown) => onSuccess(data as never) }),
    }),
});
