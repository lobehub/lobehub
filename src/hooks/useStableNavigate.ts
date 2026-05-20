import { useCallback } from 'react';
import type { NavigateFunction } from 'react-router-dom';

import { getStableNavigate } from '@/utils/stableNavigate';

/**
 * Stable `navigate` that forwards to the live ref on each call (see `NavigatorRegistrar`).
 * Prefer over subscribing to `navigationRef` from `useGlobalStore` in components.
 */
export function useStableNavigate(): NavigateFunction {
  return useCallback(
    ((to, options) => {
      const navigate = getStableNavigate();
      if (!navigate) return;
      if (typeof to === 'number') {
        navigate(to);
      } else {
        navigate(to, options);
      }
    }) as NavigateFunction,
    [],
  );
}
