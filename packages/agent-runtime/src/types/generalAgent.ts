import {
  type ChatToolPayload,
  type DynamicInterventionResolver,
  type GlobalInterventionAuditConfig,
  type MessageToolCall,
} from '@lobechat/types';

export interface GeneralAgentCallLLMInstructionPayload {
  /** Force create a new assistant message (e.g., after compression) */
  createAssistantMessage?: boolean;
  isFirstMessage?: boolean;
  messages: any[];
  model: string;
  parentMessageId?: string;
  provider: string;
  tools: any[];
}

export interface GeneralAgentCallLLMResultPayload {
  hasToolsCalling: boolean;
  parentMessageId: string;
  result: { content: string; tool_calls: MessageToolCall[] };
  toolsCalling: ChatToolPayload[];
}

export interface GeneralAgentCallingToolInstructionPayload {
  parentMessageId: string;
  skipCreateToolMessage?: boolean;
  toolCalling: ChatToolPayload;
}

export interface GeneralAgentCallToolResultPayload {
  data: any;
  executionTime: number;
  isSuccess: boolean;
  parentMessageId: string;
  /** Whether tool requested to stop execution (e.g., group management speak/delegate, GTD async tasks) */
  stop?: boolean;
  toolCall: ChatToolPayload;
  toolCallId: string;
}

export interface GeneralAgentCallToolsBatchInstructionPayload {
  parentMessageId: string;
  toolsCalling: ChatToolPayload[];
}

export interface GeneralAgentCallToolsBatchResultPayload {
  parentMessageId: string;
  toolCount: number;
  toolResults: GeneralAgentCallToolResultPayload[];
}

export interface GeneralAgentHumanAbortPayload {
  /** Whether there are pending tool calls */
  hasToolsCalling?: boolean;
  /** Parent message ID (assistant message) */
  parentMessageId: string;
  /** Reason for the abort */
  reason: string;
  /** LLM result including content and tool_calls */
  result?: {
    content: string;
    tool_calls?: any[];
  };
  /** Pending tool calls that need to be cancelled */
  toolsCalling?: ChatToolPayload[];
}

export interface GeneralAgentConfig {
  agentConfig?: {
    [key: string]: any;
    maxSteps?: number;
  };
  /**
   * Context compression configuration
   * When enabled and triggered, ALL messages are compressed into a single MessageGroup summary.
   */
  compressionConfig?: {
    /** Whether context compression is enabled (default: true) */
    enabled?: boolean;
    /** Model's max context window token count (default: 128k) */
    maxWindowToken?: number;
  };
  /**
   * Dynamic intervention audits registry (per-tool)
   * Used to evaluate runtime intervention policies for tools with dynamic config
   */
  dynamicInterventionAudits?: Record<string, DynamicInterventionResolver>;
  /**
   * Global intervention resolvers that run for EVERY tool call
   * Evaluated in array order, before per-tool dynamic resolvers.
   * When not provided, defaults to [createSecurityBlacklistGlobalAudit()]
   */
  globalInterventionAudits?: GlobalInterventionAuditConfig[];
  modelRuntimeConfig?: {
    /**
     * Compression model configuration
     * Used for context compression tasks
     */
    compressionModel?: {
      model: string;
      provider: string;
    };
    model: string;
    provider: string;
  };
  operationId: string;
  userId?: string;
}

/**
 * Payload for compression_result phase
 */
export interface GeneralAgentCompressionResultPayload {
  /** Compressed messages (summary + pinned + recent) */
  compressedMessages: any[];
  /** Compression group ID in database */
  groupId: string;
  /** Parent message ID for subsequent LLM call (last assistant message before compression) */
  parentMessageId?: string;
  /** Whether compression was skipped (no messages to compress) */
  skipped?: boolean;
}
