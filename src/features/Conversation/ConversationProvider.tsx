'use client';

import type { UIChatMessage } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { type ReactNode, memo } from 'react';

import StoreUpdater from './StoreUpdater';
import { Provider, createStore } from './store';
import type {
  ActionsBarConfig,
  ConversationContext,
  ConversationHooks,
  OperationState,
} from './types';

export interface ConversationProviderProps {
  /**
   * Actions bar configuration by message type
   */
  actionsBar?: ActionsBarConfig;
  children: ReactNode;
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
   */
  onMessagesChange?: (messages: UIChatMessage[]) => void;
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
    context,
    hooks = {},
    hasInitMessages,
    messages,
    onMessagesChange,
    operationState,
    skipFetch,
  }) => {
    return (
      <Provider createStore={() => createStore({ context, hooks, skipFetch })}>
        <StoreUpdater
          actionsBar={actionsBar}
          context={context}
          hasInitMessages={hasInitMessages}
          hooks={hooks}
          messages={messages}
          onMessagesChange={onMessagesChange}
          operationState={operationState}
          skipFetch={skipFetch}
        />
        {children}
      </Provider>
    );
  },
  isEqual,
);

ConversationProvider.displayName = 'ConversationProvider';
