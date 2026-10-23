import { useCallback } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/**
 * react-router records the session-history index in `history.state.idx`; `0`
 * means this page was the entry point (deep link, refresh, new tab), so there is
 * no in-app page to go back to.
 */
export const canGoBackInApp = () => {
  if (typeof window === 'undefined') return false;
  const idx = (window.history.state as { idx?: number } | null)?.idx;
  return typeof idx === 'number' && idx > 0;
};

/** Back for a full-screen mobile page: history when reached in-app, else `fallback`. */
export const useMobileBack = (fallback = '/') => {
  const navigate = useWorkspaceAwareNavigate();

  return useCallback(() => {
    if (canGoBackInApp()) navigate(-1);
    else navigate(fallback);
  }, [fallback, navigate]);
};
