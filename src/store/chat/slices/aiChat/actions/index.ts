import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';
import { flattenActions } from '@/store/utils/flattenActions';

import { type ConversationControlAction } from './conversationControl';
import { ConversationControlActionImpl } from './conversationControl';
import { type ConversationLifecycleAction } from './conversationLifecycle';
import { ConversationLifecycleActionImpl } from './conversationLifecycle';
import { type ChatMemoryAction } from './memory';
import { ChatMemoryActionImpl } from './memory';
import { type StreamingExecutorAction } from './streamingExecutor';
import { StreamingExecutorActionImpl } from './streamingExecutor';
import { type StreamingStatesAction } from './streamingStates';
import { StreamingStatesActionImpl } from './streamingStates';

export type ChatAIChatAction = ChatMemoryAction &
  ConversationLifecycleAction &
  ConversationControlAction &
  StreamingExecutorAction &
  StreamingStatesAction;

export const chatAiChat: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatAIChatAction
> = (
  ...params: Parameters<
    StateCreator<ChatStore, [['zustand/devtools', never]], [], ChatAIChatAction>
  >
) =>
  flattenActions<ChatAIChatAction>([
    new ChatMemoryActionImpl(...params),
    new ConversationLifecycleActionImpl(...params),
    new ConversationControlActionImpl(...params),
    new StreamingExecutorActionImpl(...params),
    new StreamingStatesActionImpl(...params),
  ]);
