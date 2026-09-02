import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';

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
  const location = useLocation();
  const navigate = useNavigate();
  const messageId = useMemo(() => parseMessageIdFromHash(location.hash), [location.hash]);
  const clearHash = useCallback(() => {
    navigate(`${location.pathname}${location.search}`, { replace: true });
  }, [location.pathname, location.search, navigate]);

  return useMemo(
    () =>
      messageId ? { id: messageId, navigationKey: location.key, onHandled: clearHash } : undefined,
    [clearHash, location.key, messageId],
  );
};
