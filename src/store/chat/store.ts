// sort-imports-ignore
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { type ChatStoreState, initialState } from './initialState';
import { type ChatBuiltinToolAction, chatToolSlice } from './slices/builtinTool/actions';
import { type ChatPortalAction, chatPortalSlice } from './slices/portal/action';
import { type ChatTranslateAction, chatTranslate } from './slices/translate/action';
import { type ChatMessageAction, chatMessage } from './slices/message/actions';
import { type ChatPluginAction, chatPlugin } from './slices/plugin/actions';
import { type ChatTopicAction, chatTopic } from './slices/topic/action';
import { type ChatAIChatAction, chatAiChat } from './slices/aiChat/actions';
import { type ChatTTSAction, chatTTS } from './slices/tts/action';
import { type ChatThreadAction, chatThreadMessage } from './slices/thread/action';
import { type OperationActions, operationActions } from './slices/operation/actions';
import { type ChatAIAgentAction, chatAiAgent } from './slices/aiAgent/actions';

export interface ChatStoreAction
  extends
    ChatMessageAction,
    ChatThreadAction,
    ChatAIChatAction,
    ChatTopicAction,
    ChatTranslateAction,
    ChatTTSAction,
    ChatPluginAction,
    ChatBuiltinToolAction,
    ChatPortalAction,
    OperationActions,
    ChatAIAgentAction {}

export type ChatStore = ChatStoreAction & ChatStoreState;

//  ===============  Aggregate createStoreFn ============ //

const createStore: StateCreator<ChatStore, [['zustand/devtools', never]]> = (...params) => ({
  ...initialState,

  ...chatMessage(...params),
  ...chatThreadMessage(...params),
  ...chatAiChat(...params),
  ...chatTopic(...params),
  ...chatTranslate(...params),
  ...chatTTS(...params),
  ...chatToolSlice(...params),
  ...chatPlugin(...params),
  ...chatPortalSlice(...params),
  ...operationActions(...params),
  ...chatAiAgent(...params),

  // cloud
});

//  ===============  Implement useStore ============ //
const devtools = createDevtools('chat');

export const useChatStore = createWithEqualityFn<ChatStore>()(
  subscribeWithSelector(devtools(createStore)),
  shallow,
);

export const getChatStoreState = () => useChatStore.getState();
