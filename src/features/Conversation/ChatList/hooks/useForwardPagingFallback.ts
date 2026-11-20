import { useEffect } from 'react';

import { ForwardPagingUnsupportedError } from '@/services/message/roundCursorPage';

interface UseForwardPagingFallbackOptions {
  errors: unknown[];
  onUnsupported?: () => void;
  paging: 'backward' | 'forward';
}

/**
 * A forward list whose server answers without paging forward (rolled back
 * after the page was rendered) cannot continue: hand it back to its owner,
 * which re-reads it newest-first. Returns whether that hand-over is under way,
 * so the failure is not shown meanwhile.
 */
export const useForwardPagingFallback = ({
  errors,
  onUnsupported,
  paging,
}: UseForwardPagingFallbackOptions) => {
  const fallingBack =
    paging === 'forward' &&
    !!onUnsupported &&
    errors.some((error) => error instanceof ForwardPagingUnsupportedError);

  useEffect(() => {
    if (fallingBack) onUnsupported?.();
  }, [fallingBack, onUnsupported]);

  return fallingBack;
};
