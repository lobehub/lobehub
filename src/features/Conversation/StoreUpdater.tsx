'use client';

import { type UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useConversationStoreApi } from './store';
import { createEphemeralResetState } from './store/initialState';
import {
  type ActionsBarConfig,
  type ComposerTarget,
  type ConversationContext,
  type ConversationHooks,
  createComposerTarget,
  type MessagesChangeMeta,
  type OperationState,
} from './types';

const log = debug('lobe-render:features:Conversation');

export interface StoreUpdaterProps {
  /**
   * Actions bar configuration by message type
   */
  actionsBar?: ActionsBarConfig;
  composerTarget?: ComposerTarget;
  context: ConversationContext;
  /**
   * Whether external messages have been initialized
   */
  hasInitMessages?: boolean;
  hooks?: ConversationHooks;
  /**
   * External messages to sync into the store
   */
  messages?: UIChatMessage[];
  /**
   * Callback when messages are fetched or changed internally
   */
  onMessagesChange?: (
    messages: UIChatMessage[],
    context: ConversationContext,
    meta?: MessagesChangeMeta,
  ) => void;
  /**
   * External operation state (from ChatStore)
   */
  operationState?: OperationState;
  /**
   * Skip internal message fetching (when external messages are provided)
   */
  skipFetch?: boolean;
}

const StoreUpdater = memo<StoreUpdaterProps>(
  ({
    actionsBar,
    composerTarget,
    context,
    hasInitMessages,
    hooks,
    messages,
    onMessagesChange,
    operationState,
    skipFetch,
  }) => {
    const storeApi = useConversationStoreApi();
    const useStoreUpdater = createStoreUpdater(storeApi);
    const prevMessagesRef = useRef<UIChatMessage[] | undefined>(undefined);
    const contextKey = messageMapKey(context);
    const resolvedComposerTarget = useMemo(
      () => composerTarget ?? createComposerTarget(contextKey),
      [composerTarget, contextKey],
    );

    useStoreUpdater('actionsBar', actionsBar);
    useStoreUpdater('composerTarget', resolvedComposerTarget);
    useStoreUpdater('context', context);
    useStoreUpdater('hooks', hooks!);
    useStoreUpdater('onMessagesChange', onMessagesChange);
    useStoreUpdater('operationState', operationState!);
    useStoreUpdater('skipFetch', skipFetch!);

    // Reset store state before paint when context changes.
    // useLayoutEffect fires after commit but before browser paint, and React processes
    // store updates triggered here synchronously — so subscribers re-render before paint.
    const prevContextKeyRef = useRef(contextKey);
    useLayoutEffect(() => {
      if (prevContextKeyRef.current !== contextKey) {
        prevContextKeyRef.current = contextKey;
        prevMessagesRef.current = undefined;

        // Update context first so replaceMessages uses the correct context
        // when calling onMessagesChange (otherwise writes to the old topic key)
        storeApi.setState({
          ...createEphemeralResetState(),
          context,
          dbMessages: messages ?? [],
          displayMessages: [],
          messagesInit: false,
        });

        // If messages are already available, sync them immediately.
        // skipOnMessagesChange: this is external → internal sync; echoing back
        // through onMessagesChange would re-write the SWR cache with the (possibly
        // partial) bucket and discard an in-flight switch-time revalidation.
        if (messages) {
          storeApi.getState().replaceMessages(messages, { skipOnMessagesChange: true });
          storeApi.setState({ messagesInit: true });
        }
      }
    }, [contextKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // Initialization is a one-way settled-data signal within a conversation.
    // A hydrated SWR snapshot may set it to true in a child layout effect while
    // the parent ChatStore projection is still one render behind. Mirroring a
    // stale `hasInitMessages=false` back into the store would then erase that
    // cache hit and paint a skeleton. Context changes reset it explicitly in
    // the layout effect above; external data only needs to promote it to true.
    useLayoutEffect(() => {
      if (!skipFetch && !hasInitMessages) return;
      if (storeApi.getState().messagesInit) return;

      storeApi.setState({ messagesInit: true });
    }, [hasInitMessages, skipFetch, storeApi]);

    // Sync external messages into store
    useEffect(() => {
      if (messages) {
        const prevMessages = prevMessagesRef.current;
        const prevCount = prevMessages?.length ?? 0;
        const newCount = messages.length;
        const isSameReference = prevMessages === messages;
        const storeMessages = storeApi.getState().dbMessages;

        log(
          '[StoreUpdater] messages effect | contextKey=%s | prevCount=%d | newCount=%d | sameRef=%s | storeCount=%d | messageIds=%o',
          contextKey,
          prevCount,
          newCount,
          isSameReference,
          storeMessages.length,
          messages.slice(0, 5).map((m) => m.id),
        );

        prevMessagesRef.current = messages;
        // External → internal sync: never echo back through onMessagesChange
        // (would poison the SWR cache with the possibly-partial bucket and
        // discard an in-flight revalidation — see DataAction.replaceMessages).
        storeApi.getState().replaceMessages(messages, { skipOnMessagesChange: true });
      }
    }, [messages, storeApi, contextKey]);

    return null;
  },
);

StoreUpdater.displayName = 'ConversationStoreUpdater';

export default StoreUpdater;
