// sort-imports-ignore
import { type ChatToolState, initialToolState } from './slices/builtinTool/initialState';
import { type ChatPortalState, initialChatPortalState } from './slices/portal/initialState';
import { type ChatMessageState, initialMessageState } from './slices/message/initialState';
import { type ChatTopicState, initialTopicState } from './slices/topic/initialState';
import { type ChatAIChatState, initialAiChatState } from './slices/aiChat/initialState';
import { type ChatThreadState, initialThreadState } from './slices/thread/initialState';
import { type ChatOperationState, initialOperationState } from './slices/operation/initialState';
import { initialAiAgentState, type ChatAIAgentState } from './slices/aiAgent/initialState';

export type ChatStoreState = ChatTopicState &
  ChatMessageState &
  ChatAIChatState &
  ChatToolState &
  ChatThreadState &
  ChatPortalState &
  ChatAIAgentState &
  ChatOperationState;

export const initialState: ChatStoreState = {
  ...initialMessageState,
  ...initialAiChatState,
  ...initialTopicState,
  ...initialToolState,
  ...initialThreadState,
  ...initialChatPortalState,
  ...initialOperationState,
  ...initialAiAgentState,

  // cloud
};
