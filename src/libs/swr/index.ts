import useSWR, { type SWRHook } from 'swr';

/**
 * This type of request method is for relatively flexible data, which will be triggered on the first time.
 *
 * Refresh rules have two types:
 * - When the user refocuses, it will be refreshed outside the 5mins interval.
 * - Can be combined with refreshXXX methods to refresh data.
 *
 * Suitable for messages, topics, sessions, and other data that users will interact with on the client.
 */
// @ts-ignore
export const useClientDataSWR: SWRHook = (key, fetch, config) =>
  useSWR(key, fetch, {
    // default is 2000ms ,it makes the user's quick switch don't work correctly.
    // Cause issue like this: https://github.com/lobehub/lobe-chat/issues/532
    // we need to set it to 0.
    dedupingInterval: 0,
    focusThrottleInterval: 5 * 60 * 1000,
    // Custom error retry logic: don't retry on 401 errors
    onErrorRetry: (error: any, key: any, config: any, revalidate: any, { retryCount }: any) => {
      // Check if error is marked as non-retryable (e.g., 401 authentication errors)
      if (error?.meta?.shouldRetry === false) {
        return;
      }
      // For other errors, use default SWR retry behavior
      // Default: exponential backoff, max 5 retries
      if (retryCount >= 5) return;
      const exponentialDelay = 1000 * Math.pow(2, Math.min(retryCount, 10));
      const timeout = Math.min(exponentialDelay, 30_000);
      setTimeout(() => revalidate({ retryCount }), timeout);
    },
    refreshWhenOffline: false,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    ...config,
  });

/**
 * This type of request method is a relatively "static" request mode, which will only be triggered on the first request.
 * Suitable for first time requests like `initUserState`.
 */
// @ts-ignore
export const useOnlyFetchOnceSWR: SWRHook = (key, fetch, config) =>
  useSWR(key, fetch, {
    refreshWhenOffline: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    ...config,
  });

/**
 * This type of request method is for action triggers. Must use mutate to trigger the request.
 * Benefits: built-in loading/error states, easy to handle loading/error UI interactions.
 * Components with the same SWR key will automatically share loading state (e.g., create agent button and the + button in header).
 * Very suitable for create operations.
 *
 * Uses fallbackData as empty object so SWR thinks initial data exists.
 * Combined with revalidateOnMount: false, this prevents auto-fetch on mount.
 */
// @ts-ignore
export const useActionSWR: SWRHook = (key, fetch, config) =>
  useSWR(key, fetch, {
    // Use empty object as fallback to prevent auto-fetch when cache is empty
    // Combined with revalidateOnMount: false, SWR won't call fetcher on mount
    fallbackData: {},
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    // If we disable `revalidateOnMount` but keep `revalidateIfStale` enabled (default true),
    // SWR can infer `isValidating=true` on subsequent renders while never actually starting a request.
    // This will lock action buttons in loading state.
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnMount: false,
    revalidateOnReconnect: false,
    ...config,
  });

export interface SWRRefreshParams<T, A = (...args: any[]) => any> {
  action: A;
  optimisticData?: (data: T | undefined) => T;
}

export type SWRefreshMethod<T> = <A extends (...args: any[]) => Promise<any>>(
  params?: SWRRefreshParams<T, A>,
) => ReturnType<A>;

// Export hook with auto-sync functionality
export { useClientDataSWRWithSync } from './useClientDataSWRWithSync';

// Export scoped mutate (for custom cache provider scenarios)
export { mutate, setScopedMutate } from './mutate';
