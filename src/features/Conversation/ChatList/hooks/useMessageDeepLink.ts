import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { highlightMessageWhenScrollSettles } from '@/features/Portal/TopicComments/messageLocator';

import type { MessageDeepLink } from '../utils/messageDeepLink';

/**
 * `?locate=<messageId>` links back to the turn behind something else (e.g. the
 * conversation a memory rule was learned in) and flashes it once it is in view.
 */
export const LOCATE_MESSAGE_PARAM = 'locate';

export const parseMessageIdFromHash = (hash: string) => {
  const encodedId = hash.replace(/^#/, '');
  if (!encodedId) return;

  try {
    return decodeURIComponent(encodedId);
  } catch {
    return encodedId;
  }
};

const hasMessageElement = (messageId: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]')).some(
    (element) => element.dataset.messageId === messageId,
  );

/**
 * Reads a message hash or `?locate=` target and consumes it after the
 * conversation has located it.
 *
 * Both go through the list's own deep-link handling instead of scrolling the
 * list from outside: on open the list restores the saved position or jumps to
 * the bottom, and an outside scroll loses to that restore (it keeps jumping
 * until the rows stop resizing, which a revalidation prolongs).
 */
export const useMessageDeepLink = (): MessageDeepLink | undefined => {
  const location = useLocation();
  const navigate = useNavigate();
  const hashMessageId = useMemo(() => parseMessageIdFromHash(location.hash), [location.hash]);
  const locateMessageId = useMemo(
    () => new URLSearchParams(location.search).get(LOCATE_MESSAGE_PARAM) || undefined,
    [location.search],
  );
  const messageId = hashMessageId ?? locateMessageId;
  const isLocate = !hashMessageId && !!locateMessageId;

  const onHandled = useCallback<NonNullable<MessageDeepLink['onHandled']>>(
    (target) => {
      if (isLocate) {
        highlightMessageWhenScrollSettles(
          hasMessageElement(target.id) ? target.id : target.displayMessageId,
        );
      }
      // Drop the target from the URL so a reload does not jump again.
      const search = new URLSearchParams(location.search);
      search.delete(LOCATE_MESSAGE_PARAM);
      const query = search.toString();
      navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true });
    },
    [isLocate, location.pathname, location.search, navigate],
  );

  return useMemo(
    () =>
      messageId
        ? {
            id: messageId,
            navigationKey: location.key,
            onHandled,
            // A locate link flashes whichever row shows the message, so a task
            // without its own anchor completes on its task-group row.
            settleOnOwningRow: isLocate,
          }
        : undefined,
    [isLocate, location.key, messageId, onHandled],
  );
};
