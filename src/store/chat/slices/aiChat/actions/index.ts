import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';

import { type ConversationControlAction, conversationControl } from './conversationControl';
import { type ConversationLifecycleAction, conversationLifecycle } from './conversationLifecycle';
import { type ChatMemoryAction, chatMemory } from './memory';
import { type StreamingExecutorAction, streamingExecutor } from './streamingExecutor';
import { type StreamingStatesAction, streamingStates } from './streamingStates';

export interface ChatAIChatAction
  extends
    ChatMemoryAction,
    ConversationLifecycleAction,
    ConversationControlAction,
    StreamingExecutorAction,
    StreamingStatesAction {}

export const chatAiChat: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatAIChatAction
> = (...params) => ({
  ...chatMemory(...params),
  ...conversationLifecycle(...params),
  ...conversationControl(...params),
  ...streamingExecutor(...params),
  ...streamingStates(...params),
});
