import { useCallback } from 'react';

import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

export type SendKey = 'enter' | 'modEnter';

/**
 * Bridges the chat send-key choice (Enter vs Cmd/Ctrl+Enter) to the
 * `useCmdEnterToSend` user preference.
 */
export const useSendKeyPreference = () => {
  const useCmdEnterToSend = useUserStore(preferenceSelectors.useCmdEnterToSend);
  const updatePreference = useUserStore((s) => s.updatePreference);

  const sendKey: SendKey = useCmdEnterToSend ? 'modEnter' : 'enter';

  const setSendKey = useCallback(
    (next: SendKey) => updatePreference({ useCmdEnterToSend: next === 'modEnter' }),
    [updatePreference],
  );

  return { sendKey, setSendKey };
};
