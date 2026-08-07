import { type UIChatMessage } from '@lobechat/types';

import {
  type ActionsBarConfig,
  type ComposerTarget,
  type ConversationContext,
  type ConversationHooks,
  type MessagesChangeMeta,
  type OperationState,
} from '../types';
import { DEFAULT_OPERATION_STATE } from '../types/operation';
import { type DataState } from './slices/data/initialState';
import { dataInitialState } from './slices/data/initialState';
import { type InputState } from './slices/input/initialState';
import { inputInitialState } from './slices/input/initialState';
import { type MessageStateState } from './slices/messageState/initialState';
import { messageStateInitialState } from './slices/messageState/initialState';
import { type VirtuaListState } from './slices/virtuaList/initialState';
import { virtuaListInitialState } from './slices/virtuaList/initialState';

export interface State extends DataState, InputState, MessageStateState, VirtuaListState {
  /**
   * Actions bar configuration by message type
   */
  actionsBar?: ActionsBarConfig;

  /**
   * Composer capability for this mounted conversation surface
   */
  composerTarget: ComposerTarget;

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
   * @param meta - Set when the messages are a fetched server snapshot rather
   *   than an internal mutation (see MessagesChangeMeta)
   */
  onMessagesChange?: (
    messages: UIChatMessage[],
    context: ConversationContext,
    meta?: MessagesChangeMeta,
  ) => void;

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
  composerTarget: { reason: 'unresolved', writable: false },
  context: {
    agentId: '',
    threadId: null,
    topicId: null,
  },
  hooks: {},
  onMessagesChange: undefined,
  operationState: DEFAULT_OPERATION_STATE,
};

/**
 * State patch applied in place on context switch (the Provider is NOT keyed by
 * context, so the store instance survives). Deliberately excludes fields owned
 * by still-mounted UI infra — `editor`, `chatInputOverlayHeight`,
 * `virtuaScrollMethods` — which stay valid across the switch and are managed by
 * their components' own mount/unmount lifecycles.
 */
export const createEphemeralResetState = (): Partial<State> => ({
  activeIndex: null,
  atBottom: true,
  heteroOverloadRetryAttempts: {},
  heteroOverloadWaitOpIds: {},
  inputMessage: '',
  isScrolling: false,
  messageEditingIds: [],
  messageLoadingIds: [],
  pendingArgsUpdates: new Map(),
  scheduledSendAt: undefined,
  selectedMessageIds: [],
  selectionAnchorId: undefined,
  selectionMode: false,
  visibleItems: new Map(),
});
