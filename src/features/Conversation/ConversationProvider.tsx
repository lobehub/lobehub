'use client';

import { type UIChatMessage } from '@lobechat/types';
import debug from 'debug';
import isEqual from 'fast-deep-equal';
import { type ReactNode } from 'react';
import { memo, useMemo } from 'react';

import { useFetchAvailableAgents } from '@/hooks/useFetchAvailableAgents';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import AssistantTurnSettledWatcher from './AssistantTurnSettledWatcher';
import { createStore, Provider } from './store';
import StoreUpdater from './StoreUpdater';
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

interface ConversationContextPrefetcherProps {
  context: ConversationContext;
}

const ConversationContextPrefetcher = memo<ConversationContextPrefetcherProps>(({ context }) => {
  useFetchAvailableAgents(!context.topicShareId && !context.agentShareId && !!context.agentId);

  return null;
});

ConversationContextPrefetcher.displayName = 'ConversationContextPrefetcher';

export interface ConversationProviderProps {
  /**
   * Actions bar configuration by message type
   */
  actionsBar?: ActionsBarConfig;
  children: ReactNode;
  /**
   * Explicit composer capability for this surface. Defaults to this
   * conversation's own context key.
   */
  composerTarget?: ComposerTarget;
  /**
   * Conversation context (data coordinates)
   */
  context: ConversationContext;
  /**
   * Whether external messages have been initialized
   * When false, ChatList will show skeleton loading state
   */
  hasInitMessages?: boolean;
  /**
   * Lifecycle hooks for external behavior injection
   */
  hooks?: ConversationHooks;
  /**
   * External messages to sync into the store
   * When provided, these messages will be used as the source of truth
   */
  messages?: UIChatMessage[];
  /**
   * Callback when messages are fetched or changed internally
   * Use this to sync messages back to external state (e.g., ChatStore)
   *
   * @param messages - The updated messages array
   * @param context - The context that this data belongs to (prevents race conditions)
   * @param meta - Set when the messages are a fetched server snapshot; forward
   *   it as `source` to ChatStore.replaceMessages so the SWR write-through can
   *   skip fetch echoes (see MessagesChangeMeta)
   */
  onMessagesChange?: (
    messages: UIChatMessage[],
    context: ConversationContext,
    meta?: MessagesChangeMeta,
  ) => void;
  /**
   * External operation state (from ChatStore)
   *
   * This state is managed by the global ChatStore and passed down for reactivity.
   * Operations are kept global to support multiple agents/topics running in parallel.
   *
   * When provided, this will be synced into the store for reactive updates.
   */
  operationState?: OperationState;
  skipFetch?: boolean;
}

/**
 * ConversationProvider
 *
 * Creates an isolated ConversationStore instance for a specific conversation context.
 * This enables multiple independent conversations to run simultaneously.
 */
export const ConversationProvider = memo<ConversationProviderProps>(
  ({
    actionsBar,
    children,
    composerTarget,
    context,
    hooks = {},
    hasInitMessages,
    messages,
    onMessagesChange,
    operationState,
    skipFetch,
  }) => {
    const contextKey = useMemo(() => messageMapKey(context), [context]);
    const resolvedComposerTarget = useMemo(
      () => composerTarget ?? createComposerTarget(contextKey),
      [composerTarget, contextKey],
    );

    log(
      '[Provider] render | contextKey=%s | messagesCount=%d | hasInitMessages=%s | skipFetch=%s',
      contextKey,
      messages?.length ?? 0,
      hasInitMessages,
      skipFetch,
    );

    return (
      <Provider
        createStore={() =>
          createStore({
            composerTarget: resolvedComposerTarget,
            context,
            hooks,
            initialMessages: messages,
            skipFetch,
          })
        }
      >
        <StoreUpdater
          actionsBar={actionsBar}
          composerTarget={resolvedComposerTarget}
          context={context}
          hasInitMessages={hasInitMessages}
          hooks={hooks}
          messages={messages}
          operationState={operationState}
          skipFetch={skipFetch}
          onMessagesChange={onMessagesChange}
        />
        <AssistantTurnSettledWatcher />
        <ConversationContextPrefetcher context={context} />
        {children}
      </Provider>
    );
  },
  isEqual,
);

ConversationProvider.displayName = 'ConversationProvider';
