import { useCallback } from 'react';
import { useSWRConfig } from 'swr';

import { useSingleton } from '@/hooks/useSingleton';

/**
 * A thrown SWR error carries no key, so the only way for the route's Retry to
 * revalidate what actually failed is to record the keys as they fail. Without
 * this the reset has to match the whole cache, and one route's Retry refetches
 * every mounted consumer in the app.
 */
export const useRouteRetry = () => {
  const { mutate } = useSWRConfig();
  const failedKeys = useSingleton(() => new Set<string>());

  const onError = useCallback(
    (_error: unknown, key: string) => {
      failedKeys.add(key);
    },
    [failedKeys],
  );

  const onReset = useCallback(() => {
    if (failedKeys.size === 0) return;
    const keys = new Set(failedKeys);
    failedKeys.clear();
    mutate((key) => typeof key === 'string' && keys.has(key), undefined, { revalidate: true });
  }, [failedKeys, mutate]);

  return { onError, onReset };
};
