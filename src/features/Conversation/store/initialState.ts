import {
  type ActionsBarConfig,
  type ComposerTarget,
  type ConversationContext,
  type ConversationHooks,
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
  autoScrollDetached: false,
  earlierMessagesError: undefined,
  heteroOverloadRetryAttempts: {},
  heteroOverloadWaitOpIds: {},
  inputMessage: '',
  isLoadingEarlierMessages: false,
  isLoadingLaterMessages: false,
  laterMessagesError: undefined,
  refreshingRowId: undefined,
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
