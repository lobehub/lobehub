'use client';

import type { UIChatMessage } from '@lobechat/types';
import { memo, useEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useConversationStoreApi } from './store';
import type {
  ActionsBarConfig,
  ConversationContext,
  ConversationHooks,
  OperationState,
} from './types';

export interface StoreUpdaterProps {
  /**
   * Actions bar configuration by message type
   */
  actionsBar?: ActionsBarConfig;
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
  onMessagesChange?: (messages: UIChatMessage[], context: ConversationContext) => void;
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

    useStoreUpdater('actionsBar', actionsBar);
    useStoreUpdater('context', context);
    useStoreUpdater('hooks', hooks!);
    useStoreUpdater('onMessagesChange', onMessagesChange);
    useStoreUpdater('operationState', operationState!);
    useStoreUpdater('skipFetch', skipFetch!);

    // When external messages are provided, mark as initialized
    useStoreUpdater('messagesInit', skipFetch ? true : (hasInitMessages ?? false));

    // Sync external messages into store
    useEffect(() => {
      if (messages) {
        storeApi.getState().replaceMessages(messages);
      }
    }, [messages, storeApi]);

    return null;
  },
);

StoreUpdater.displayName = 'ConversationStoreUpdater';

export default StoreUpdater;
