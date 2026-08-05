'use client';

import { type ReactNode, useCallback, useState } from 'react';

export type LazyActions = ReactNode | (() => ReactNode);

/**
 * Defers a row's action slot until the row is first pointed at or focused.
 *
 * `mount` is idempotent and one-way: once the actions exist they stay, so an
 * open dropdown survives the pointer leaving the row. A plain node passes
 * straight through — only the thunk form is deferred.
 */
export const useLazyActions = (actions?: LazyActions) => {
  const isLazy = typeof actions === 'function';
  const [mounted, setMounted] = useState(false);

  const mount = useCallback(() => {
    if (isLazy) setMounted(true);
  }, [isLazy]);

  return {
    mount,
    node: isLazy ? (mounted ? actions() : null) : actions,
  };
};
