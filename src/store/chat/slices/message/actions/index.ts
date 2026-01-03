import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';

import { type MessageInternalsAction, messageInternals } from './internals';
import { type MessageOptimisticUpdateAction, messageOptimisticUpdate } from './optimisticUpdate';
import { type MessagePublicApiAction, messagePublicApi } from './publicApi';
import { type MessageQueryAction, messageQuery } from './query';
import { type MessageRuntimeStateAction, messageRuntimeState } from './runtimeState';

/**
 * Combined message action interface
 * Aggregates all message-related actions
 */
export interface ChatMessageAction
  extends MessagePublicApiAction,
    MessageOptimisticUpdateAction,
    MessageQueryAction,
    MessageRuntimeStateAction,
    MessageInternalsAction {
  /**/
}

/**
 * Combined message action creator
 * Merges all message action modules
 */
export const chatMessage: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatMessageAction
> = (...params) => ({
  ...messagePublicApi(...params),
  ...messageOptimisticUpdate(...params),
  ...messageQuery(...params),
  ...messageRuntimeState(...params),
  ...messageInternals(...params),
});
