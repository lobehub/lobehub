import { isCommandPressed } from '@lobechat/utils';
import { useCallback } from 'react';

import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

type EnterEvent = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>;

/**
 * Returns a predicate that decides whether a chat-input key event should
 * fire send, based on the global `useCmdEnterToSend` preference.
 */
export const useEnterToSend = () => {
  const useCmdEnterToSend = useUserStore(preferenceSelectors.useCmdEnterToSend);

  return useCallback(
    (event: EnterEvent): boolean => {
      if (event.shiftKey) return false;
      const commandKey = isCommandPressed(event);
      return useCmdEnterToSend ? commandKey : !commandKey;
    },
    [useCmdEnterToSend],
  );
};
