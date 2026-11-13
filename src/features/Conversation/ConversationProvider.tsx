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
   * Lifecycle hooks for external behavior injection
   */
  hooks?: ConversationHooks;
  /**
   * A static transcript to render (a render gallery, a share snapshot). It is
   * held by this conversation and never synced. Without it the conversation
   * shows — and syncs — the chat store bucket of `context`.
   */
  messages?: UIChatMessage[];
  /**
   * External operation state (from ChatStore)
   *
   * This state is managed by the global ChatStore and passed down for reactivity.
   * Operations are kept global to support multiple agents/topics running in parallel.
   *
   * When provided, this will be synced into the store for reactive updates.
   */
  operationState?: OperationState;
  /**
   * Do not sync the transcript, e.g. while another flow owns its rows
   */
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
    messages,
    operationState,
    skipFetch,
  }) => {
    const contextKey = useMemo(() => messageMapKey(context), [context]);
    const resolvedComposerTarget = useMemo(
      () => composerTarget ?? createComposerTarget(contextKey),
      [composerTarget, contextKey],
    );

    log(
      '[Provider] render | contextKey=%s | static=%s | skipFetch=%s',
      contextKey,
      !!messages,
      skipFetch,
    );

    return (
      <Provider
        createStore={() =>
          createStore({
            composerTarget: resolvedComposerTarget,
            context,
            hooks,
            messages,
            skipFetch,
          })
        }
      >
        <StoreUpdater
          actionsBar={actionsBar}
          composerTarget={resolvedComposerTarget}
          context={context}
          hooks={hooks}
          messages={messages}
          operationState={operationState}
          skipFetch={skipFetch}
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
