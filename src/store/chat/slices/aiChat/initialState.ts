import { type ChatInputEditor } from '@/features/ChatInput';
import type { GatewayConnection } from '@/store/chat/slices/aiChat/actions/gateway';

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
   * Tool ids enabled by the current runtime scenario/page (for example the
   * tasks page enabling `lobe-task` while its panel is mounted).
   * Transient state, not persisted — cleared on reload or when pages unmount.
   */
  scenarioEnabledToolIds?: string[];
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
  scenarioEnabledToolIds: undefined,
  searchWorkflowLoadingIds: [],
  threadInputEditor: null,
  toolCallingStreamIds: {},
};
