import { type ChatInputEditor } from '@/features/ChatInput';
import type { GatewayConnection } from '@/store/chat/slices/agentRun/actions/transports/gateway/gateway';

export type MainConversationScrollToIndex = (
  index: number,
  options?: { align?: 'start' | 'center' | 'end'; smooth?: boolean },
) => void;

/**
 * Last `op_lifecycle` notice the shared gateway socket delivered for an
 * operation. Written only when the multiplexed transport routes runs
 * over the multiplexed socket; the hub emits one for every op the user owns,
 * whether or not this tab is subscribed to it.
 */
export interface GatewayFeedEntry {
  /** Hub timestamp (epoch ms) of the lifecycle transition. */
  at: number;
  /** Op routing metadata (topicId, agentId, parent/root op...) as sent by the hub. */
  meta?: Record<string, unknown>;
  /** `SessionStatus` or `gone` once the hub has forgotten the op. */
  status: string;
}

export type QuestionSubmissionPhase = 'submitting' | 'checking' | 'failed' | 'uncertain';

export interface ChatAIChatState {
  /**
   * Active Agent Gateway WebSocket connections, keyed by operationId
   */
  gatewayConnections: Record<string, GatewayConnection>;
  /**
   * Mux-level op lifecycle feed, keyed by operationId. No UI reads it yet;
   * later work drives spinners / reconnect decisions from it.
   */
  gatewayFeed: Record<string, GatewayFeedEntry>;
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
  /** Local UI feedback only; never persisted as the server intervention status. */
  questionSubmissions: Record<string, QuestionSubmissionPhase>;
  searchWorkflowLoadingIds: string[];
  threadInputEditor: ChatInputEditor | null;
  /**
   * the tool calling stream ids
   */
  toolCallingStreamIds: Record<string, boolean[]>;
}

export const initialAiChatState: ChatAIChatState = {
  gatewayConnections: {},
  gatewayFeed: {},
  inputFiles: [],
  inputMessage: '',
  mainConversationScrollToIndex: null,
  mainInputEditor: null,
  pendingClientToolExecutions: {},
  questionSubmissions: {},
  searchWorkflowLoadingIds: [],
  threadInputEditor: null,
  toolCallingStreamIds: {},
};
