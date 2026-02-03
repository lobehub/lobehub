// sort-imports-ignore
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { flattenActions } from '../utils/flattenActions';
import { type ChatStoreState, initialState } from './initialState';
import { type ChatBuiltinToolAction, chatToolSlice } from './slices/builtinTool/actions';
import { type ChatPortalAction, ChatPortalActionImpl } from './slices/portal/action';
import { type ChatTranslateAction, ChatTranslateActionImpl } from './slices/translate/action';
import { type ChatMessageAction, chatMessage } from './slices/message/actions';
import { type ChatPluginAction, chatPlugin } from './slices/plugin/actions';
import { type ChatTopicAction, ChatTopicActionImpl } from './slices/topic/action';
import { type ChatAIChatAction, chatAiChat } from './slices/aiChat/actions';
import { type ChatTTSAction, ChatTTSActionImpl } from './slices/tts/action';
import { type ChatThreadAction, ChatThreadActionImpl } from './slices/thread/action';
import { type OperationActions, OperationActionsImpl } from './slices/operation/actions';
import { type ChatAIAgentAction, chatAiAgent } from './slices/aiAgent/actions';

export type ChatStoreAction = ChatMessageAction &
  ChatThreadAction &
  ChatAIChatAction &
  ChatTopicAction &
  ChatTranslateAction &
  ChatTTSAction &
  ChatPluginAction &
  ChatBuiltinToolAction &
  ChatPortalAction &
  OperationActions &
  ChatAIAgentAction;

export type ChatStore = ChatStoreAction & ChatStoreState;

//  ===============  Aggregate createStoreFn ============ //

const createStore: StateCreator<ChatStore, [['zustand/devtools', never]]> = (
  ...params: Parameters<StateCreator<ChatStore, [['zustand/devtools', never]]>>
) =>
  ({
    ...initialState,
    ...(flattenActions<ChatStoreAction>([
      chatMessage(...params),
      new ChatThreadActionImpl(...params),
      chatAiChat(...params),
      new ChatTopicActionImpl(...params),
      new ChatTranslateActionImpl(...params),
      new ChatTTSActionImpl(...params),
      chatToolSlice(...params),
      chatPlugin(...params),
      new ChatPortalActionImpl(...params),
      new OperationActionsImpl(...params),
      chatAiAgent(...params),
    ]) as ChatStoreAction),
    // cloud
  }) as ChatStore;

//  ===============  Implement useStore ============ //
const devtools = createDevtools('chat');

export const useChatStore = createWithEqualityFn<ChatStore>()(
  subscribeWithSelector(devtools(createStore)),
  shallow,
);

if (typeof window !== 'undefined') {
  window.__CHAT_STORE__ = useChatStore;
}

export const getChatStoreState = () => useChatStore.getState();
