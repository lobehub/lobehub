import { actionToMessage } from '@lobehub/a2ui';
import { type A2uiHost, A2uiHostProvider } from '@lobehub/a2ui/react';
import { memo, type ReactNode, useMemo } from 'react';

import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';

import { useConversationStore, useConversationStoreApi } from './store';

/**
 * Where a card's buttons go in a topic: the action is posted as the person's next message, so the
 * Agent answers it like any other turn. Read-only conversations (shares, galleries) act on nothing.
 */
export const A2uiConversationHost = memo<{ children: ReactNode }>(({ children }) => {
  const api = useConversationStoreApi();
  const canAct = useConversationStore((s) => s.composerTarget.writable);

  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const host = useMemo<A2uiHost>(
    () => ({
      canAct,
      locale,
      sendAction: (action, surface) =>
        new Promise<boolean>((resolve, reject) => {
          const current = api.getState();
          if (!current.composerTarget.writable) return resolve(false);
          current
            .sendMessage({
              message: actionToMessage(action, surface),
              onMessageAccepted: () => resolve(true),
              preserveComposer: true,
            })
            .then(() => resolve(false), reject);
        }),
    }),
    [api, canAct, locale],
  );

  return <A2uiHostProvider value={host}>{children}</A2uiHostProvider>;
});

A2uiConversationHost.displayName = 'A2uiConversationHost';
