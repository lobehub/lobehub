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
  searchWorkflowLoadingIds: [],
  threadInputEditor: null,
  toolCallingStreamIds: {},
};
