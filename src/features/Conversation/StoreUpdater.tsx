'use client';

import { type UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useConversationStoreApi } from './store';
import { createEphemeralResetState } from './store/initialState';
import {
  type ActionsBarConfig,
  type ComposerTarget,
  type ConversationContext,
  type ConversationHooks,
  createComposerTarget,
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
  hooks?: ConversationHooks;
  /**
   * A static transcript, held by the store instead of the chat store bucket
   */
  messages?: UIChatMessage[];
  /**
   * External operation state (from ChatStore)
   */
  operationState?: OperationState;
  /**
   * Do not sync the transcript
   */
  skipFetch?: boolean;
}

const StoreUpdater = memo<StoreUpdaterProps>(
  ({ actionsBar, composerTarget, context, hooks, messages, operationState, skipFetch }) => {
    const storeApi = useConversationStoreApi();
    const useStoreUpdater = createStoreUpdater(storeApi);
    const contextKey = messageMapKey(context);
    const isStatic = !!messages;
    const resolvedComposerTarget = useMemo(
      () => composerTarget ?? createComposerTarget(contextKey),
      [composerTarget, contextKey],
    );

    useStoreUpdater('actionsBar', actionsBar);
    useStoreUpdater('composerTarget', resolvedComposerTarget);
    useStoreUpdater('context', context);
    useStoreUpdater('hooks', hooks!);
    useStoreUpdater('operationState', operationState!);

    // Reset store state before paint when context changes.
    // useLayoutEffect fires after commit but before browser paint, and React processes
    // store updates triggered here synchronously — so subscribers re-render before paint.
    const prevContextKeyRef = useRef(contextKey);
    useLayoutEffect(() => {
      if (prevContextKeyRef.current === contextKey) return;
      prevContextKeyRef.current = contextKey;

      storeApi.setState({
        ...createEphemeralResetState(),
        context,
        dbMessages: [],
        displayMessages: [],
        // A static transcript is always loaded; a chat bucket says so itself.
        messagesInit: isStatic,
      });
      // The mirror below re-reads the next bucket in this same pre-paint pass.
      if (messages) storeApi.getState().replaceMessages(messages);
    }, [contextKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // Mirror the chat store bucket: every write to it — a fetch, a stream
    // chunk, an edit from any surface — reaches this store synchronously.
    useLayoutEffect(() => {
      // Set here, not by a post-paint updater: the mirror reads them below.
      storeApi.setState({
        skipFetch: isStatic || !!skipFetch,
        transcriptSource: isStatic ? 'static' : 'chat',
      });
      if (isStatic) return;
      const bucket = contextKey;
      const sync = () => storeApi.getState().internal_syncChatTranscript();
      sync();
      return useChatStore.subscribe((state, prev) => {
        if (
          state.dbMessagesMap[bucket] !== prev.dbMessagesMap[bucket] ||
          state.messagesMap[bucket] !== prev.messagesMap[bucket]
        )
          sync();
      });
    }, [contextKey, isStatic, skipFetch, storeApi]);

    // A static transcript follows its prop.
    useEffect(() => {
      if (!messages) return;
      log('[StoreUpdater] static messages | contextKey=%s | count=%d', contextKey, messages.length);
      storeApi.getState().replaceMessages(messages);
    }, [messages, storeApi, contextKey]);

    return null;
  },
);

StoreUpdater.displayName = 'ConversationStoreUpdater';

export default StoreUpdater;
