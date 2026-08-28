import { type ChatInputEditor } from '@/features/ChatInput';
import type { GatewayConnection } from '@/store/chat/slices/agentRun/actions/transports/gateway/gateway';

export type MainConversationScrollToIndex = (
  index: number,
  options?: { align?: 'start' | 'center' | 'end'; smooth?: boolean },
) => void;

export interface ChatAIChatState {
  /**
   * Active Agent Gateway WebSocket connections, keyed by operationId
   */
  gatewayConnections: Record<string, GatewayConnection>;
  inputFiles: File[];
  inputMessage: string;
  /**
   * Virtual-list navigation exposed by the main conversation for sibling UI such as Portal.
   */
  mainConversationScrollToIndex: MainConversationScrollToIndex | null;
  mainInputEditor: ChatInputEditor | null;
  /**
   * Tool calls currently being executed locally on this client in response to
   * a Gateway `tool_execute` event. Key is the toolCallId; value is `true` while
   * pending. Kept separate from `toolCallingStreamIds` (LLM-side streaming) so
   * UI can render a distinct "running on device" state.
   */
  pendingClientToolExecutions: Record<string, boolean>;
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
  mainConversationScrollToIndex: null,
  mainInputEditor: null,
  pendingClientToolExecutions: {},
  searchWorkflowLoadingIds: [],
  threadInputEditor: null,
  toolCallingStreamIds: {},
};
