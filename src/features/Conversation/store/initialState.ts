import type { UIChatMessage } from '@lobechat/types';

import type {
  ActionsBarConfig,
  ConversationContext,
  ConversationHooks,
  OperationState,
} from '../types';
import { DEFAULT_OPERATION_STATE } from '../types/operation';
import { type DataState, dataInitialState } from './slices/data/initialState';
import { type InputState, inputInitialState } from './slices/input/initialState';
import {
  type MessageStateState,
  messageStateInitialState,
} from './slices/messageState/initialState';
import { type VirtuaListState, virtuaListInitialState } from './slices/virtuaList/initialState';

export interface State extends DataState, InputState, MessageStateState, VirtuaListState {
  /**
   * Actions bar configuration by message type
   */
  actionsBar?: ActionsBarConfig;

  /**
   * Conversation context (data coordinates)
   */
  context: ConversationContext;

  /**
   * Lifecycle hooks for external behavior injection
   */
  hooks: ConversationHooks;

  /**
   * Callback when messages are fetched or changed internally
   * @param messages - The updated messages array
   * @param context - The context that this data belongs to (prevents race conditions)
   */
  onMessagesChange?: (messages: UIChatMessage[], context: ConversationContext) => void;

  /**
   * External operation state (from ChatStore)
   * Used for reactive updates of operation-related UI
   */
  operationState: OperationState;
}

export const initialState: State = {
  ...dataInitialState,
  ...inputInitialState,
  ...messageStateInitialState,
  ...virtuaListInitialState,

  actionsBar: undefined,
  context: {
    agentId: '',
    threadId: null,
    topicId: null,
  },
  hooks: {},
  onMessagesChange: undefined,
  operationState: DEFAULT_OPERATION_STATE,
};
