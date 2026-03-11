import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';
import { flattenActions } from '@/store/utils/flattenActions';

import { type MessageInternalsAction } from './internals';
import { MessageInternalsActionImpl } from './internals';
import { type MessageOptimisticUpdateAction } from './optimisticUpdate';
import { MessageOptimisticUpdateActionImpl } from './optimisticUpdate';
import { type MessagePublicApiAction } from './publicApi';
import { MessagePublicApiActionImpl } from './publicApi';
import { type MessageQueryAction } from './query';
import { MessageQueryActionImpl } from './query';
import { type MessageRuntimeStateAction } from './runtimeState';
import { MessageRuntimeStateActionImpl } from './runtimeState';

export type ChatMessageAction = MessagePublicApiAction &
  MessageOptimisticUpdateAction &
  MessageQueryAction &
  MessageRuntimeStateAction &
  MessageInternalsAction;

/**
 * Combined message action interface
 * Aggregates all message-related actions
 */

export const chatMessage: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatMessageAction
> = (
  ...params: Parameters<
    StateCreator<ChatStore, [['zustand/devtools', never]], [], ChatMessageAction>
  >
) =>
  flattenActions<ChatMessageAction>([
    new MessagePublicApiActionImpl(...params),
    new MessageOptimisticUpdateActionImpl(...params),
    new MessageQueryActionImpl(...params),
    new MessageRuntimeStateActionImpl(...params),
    new MessageInternalsActionImpl(...params),
  ]);
