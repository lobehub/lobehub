import { type ChatInputEditor } from '@/features/ChatInput';
import type { GatewayConnection } from '@/store/chat/slices/aiChat/actions/gateway';

/**
 * Page-level runtime overrides for plugin/tool behavior.
 * Transient state, not persisted — cleared on reload or when pages unmount.
 */
export interface RuntimePluginOverrides {
  /**
   * Force these tool ids to be activated for every step on the current page,
   * bypassing enableChecker rules via `isExplicitActivation`.
   * Merged into stepContext.activatedToolIds in streamingExecutor.
   */
  forceActivated?: string[];
}

export interface ChatAIChatState {
  /**
   * Active Agent Gateway WebSocket connections, keyed by operationId
   */
  gatewayConnections: Record<string, GatewayConnection>;
  inputFiles: File[];
  inputMessage: string;
  mainInputEditor: ChatInputEditor | null;
  /**
   * Tool calls currently being executed locally on this client in response to
   * a Gateway `tool_execute` event. Key is the toolCallId; value is `true` while
   * pending. Kept separate from `toolCallingStreamIds` (LLM-side streaming) so
   * UI can render a distinct "running on device" state.
   */
  pendingClientToolExecutions: Record<string, boolean>;
  /**
   * Page-level runtime plugin overrides. Set by page layouts (e.g. tasks page
   * forcing `lobe-task` to be activated), cleared on unmount.
   */
  runtimePluginOverrides?: RuntimePluginOverrides;
  searchWorkflowLoadingIds: string[];
  threadInputEditor: ChatInputEditor | null;
  /**
   * the tool calling stream ids
   */
  toolCallingStreamIds: Record<string, boolean[]>;
}

export const initialAiChatState: ChatAIChatState = {
  gatewayConnections: {},
  inputFiles: [],
  inputMessage: '',
  mainInputEditor: null,
  pendingClientToolExecutions: {},
  runtimePluginOverrides: undefined,
  searchWorkflowLoadingIds: [],
  threadInputEditor: null,
  toolCallingStreamIds: {},
};
