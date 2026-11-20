import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { renderHook } from '@testing-library/react';

import { cacheScope, createReplicaState, replicaKeys } from '@/libs/replica';
import { conversationMessagesKey, conversationMessagesResource } from '@/services/message/replica';
import { useChatStore } from '@/store/chat';
import { type ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

/** Drop every transcript the chat store holds. */
export const resetTranscripts = () =>
  useChatStore.setState({
    dbMessagesMap: {},
    messagePagingMap: {},
    messageReplica: createReplicaState(),
    messagesMap: {},
    voiceMessageUploadMap: {},
  });

/** Seed a conversation's loaded rows, as a previous fetch or send left them. */
export const seedRows = (context: ConversationContext, rows: UIChatMessage[]) =>
  useChatStore.setState((state) => ({
    dbMessagesMap: { ...state.dbMessagesMap, [messageMapKey(context)]: rows },
  }));

/** The conversation's rows in the chat store (`undefined` = not loaded). */
export const rowsOf = (context: ConversationContext) =>
  useChatStore.getState().dbMessagesMap[messageMapKey(context)];

/** `useFetchMessages` is a hook: run it inside a component. */
export const syncMessages = (...args: Parameters<ChatStore['useFetchMessages']>) =>
  renderHook(() => useChatStore.getState().useFetchMessages(...args)).result.current;

/** The `replica:sync` query key a mounted transcript sync of `context` runs under. */
export const transcriptSyncKey = (context: ConversationContext) =>
  replicaKeys.sync(
    conversationMessagesResource.name,
    conversationMessagesResource.version,
    cacheScope.get(),
    conversationMessagesKey(context),
    context,
  );
