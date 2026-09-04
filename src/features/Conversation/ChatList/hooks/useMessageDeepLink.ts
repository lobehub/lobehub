import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';

import { routerSelectors, useRouterStore } from '@/store/router';

import type { MessageDeepLink } from '../utils/messageDeepLink';

export const parseMessageIdFromHash = (hash: string) => {
  const encodedId = hash.replace(/^#/, '');
  if (!encodedId) return;

  try {
    return decodeURIComponent(encodedId);
  } catch {
    return encodedId;
  }
};

/** Reads and consumes a message hash after the conversation has located the target. */
export const useMessageDeepLink = (): MessageDeepLink | undefined => {
  const hash = useRouterStore(routerSelectors.hash);
  const locationKey = useRouterStore(routerSelectors.key);
  const url = useRouterStore(routerSelectors.url);
  const navigate = useNavigate();
  const messageId = useMemo(() => parseMessageIdFromHash(hash), [hash]);
  const clearHash = useCallback(() => {
    navigate(url, { replace: true });
  }, [navigate, url]);

  return useMemo(
    () =>
      messageId ? { id: messageId, navigationKey: locationKey, onHandled: clearHash } : undefined,
    [clearHash, locationKey, messageId],
  );
};
