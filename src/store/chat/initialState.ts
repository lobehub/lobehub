// sort-imports-ignore
import { type ChatAIAgentState } from './slices/aiAgent/initialState';
import { initialAiAgentState } from './slices/aiAgent/initialState';
import { type ChatAIChatState } from './slices/aiChat/initialState';
import { initialAiChatState } from './slices/aiChat/initialState';
import { type ChatToolState } from './slices/builtinTool/initialState';
import { initialToolState } from './slices/builtinTool/initialState';
import { type ChatMessageState } from './slices/message/initialState';
import { initialMessageState } from './slices/message/initialState';
import { type ChatOperationState } from './slices/operation/initialState';
import { initialOperationState } from './slices/operation/initialState';
import { type ChatPortalState } from './slices/portal/initialState';
import { initialChatPortalState } from './slices/portal/initialState';
import { type ChatThreadState } from './slices/thread/initialState';
import { initialThreadState } from './slices/thread/initialState';
import { type ChatTopicState } from './slices/topic/initialState';
import { initialTopicState } from './slices/topic/initialState';

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
