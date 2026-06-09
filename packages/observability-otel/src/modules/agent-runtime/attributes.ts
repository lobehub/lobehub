import type { Attributes } from '@opentelemetry/api';

import {
  ATTR_GEN_AI_AGENT_DESCRIPTION,
  ATTR_GEN_AI_AGENT_ID,
  ATTR_GEN_AI_AGENT_NAME,
  ATTR_GEN_AI_AGENT_VERSION,
  ATTR_GEN_AI_CONVERSATION_ID,
  ATTR_GEN_AI_DATA_SOURCE_ID,
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_REQUEST_MAX_TOKENS,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_REQUEST_STREAM,
  ATTR_GEN_AI_REQUEST_TEMPERATURE,
  ATTR_GEN_AI_REQUEST_TOP_P,
  ATTR_GEN_AI_RESPONSE_FINISH_REASONS,
  ATTR_GEN_AI_RESPONSE_ID,
  ATTR_GEN_AI_RESPONSE_MODEL,
  ATTR_GEN_AI_RESPONSE_TIME_TO_FIRST_CHUNK,
  ATTR_GEN_AI_TOOL_CALL_ARGUMENTS,
  ATTR_GEN_AI_TOOL_CALL_ID,
  ATTR_GEN_AI_TOOL_CALL_RESULT,
  ATTR_GEN_AI_TOOL_DESCRIPTION,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_GEN_AI_TOOL_TYPE,
  ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
  ATTR_GEN_AI_USAGE_REASONING_OUTPUT_TOKENS,
  ATTR_LOBEHUB_AGENT_COMPLETION_REASON,
  ATTR_LOBEHUB_AGENT_OPERATION_ID,
  ATTR_LOBEHUB_AGENT_STEP_COUNT,
  ATTR_LOBEHUB_AGENT_STEP_INDEX,
  ATTR_LOBEHUB_CONTEXT_HAS_IMAGES,
  ATTR_LOBEHUB_CONTEXT_HISTORY_COMPRESSED,
  ATTR_LOBEHUB_CONTEXT_KNOWLEDGE_COUNT,
  ATTR_LOBEHUB_CONTEXT_KNOWLEDGE_INJECTED,
  ATTR_LOBEHUB_CONTEXT_MEMORY_INJECTED,
  ATTR_LOBEHUB_CONTEXT_MESSAGE_COUNT,
  ATTR_LOBEHUB_CONTEXT_SYSTEM_ROLE_LENGTH,
  ATTR_LOBEHUB_CONTEXT_TOKEN_USAGE,
  ATTR_LOBEHUB_CONTEXT_TOOL_COUNT,
  ATTR_LOBEHUB_CONTEXT_WINDOW_RATIO,
  ATTR_LOBEHUB_TOOL_ATTEMPTS,
  ATTR_LOBEHUB_TOOL_SOURCE,
  ATTR_LOBEHUB_TOOL_SUCCESS,
  GEN_AI_OPERATION_CHAT,
  GEN_AI_OPERATION_EXECUTE_TOOL,
  GEN_AI_OPERATION_INVOKE_AGENT,
} from './semconv';

/**
 * Drop attributes with `undefined` values so OTel exporters don't receive them.
 * OTel rejects undefined attribute values; null/empty strings are kept verbatim
 * because the caller may have an intentional reason to record them.
 */
const compact = (input: Record<string, unknown>): Attributes => {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      out[key] = value as Attributes[string];
    }
  }
  return out;
};

// ---- invoke_agent span ----

export interface InvokeAgentAttributes {
  agentDescription?: string;
  agentId?: string;
  agentName?: string;
  agentVersion?: string;
  conversationId?: string;
  dataSourceId?: string;
  operationId: string;
  provider?: string;
  requestModel?: string;
  stepIndex?: number;
}

export const buildInvokeAgentAttributes = (input: InvokeAgentAttributes): Attributes =>
  compact({
    [ATTR_GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION_INVOKE_AGENT,
    [ATTR_GEN_AI_AGENT_ID]: input.agentId,
    [ATTR_GEN_AI_AGENT_NAME]: input.agentName,
    [ATTR_GEN_AI_AGENT_DESCRIPTION]: input.agentDescription,
    [ATTR_GEN_AI_AGENT_VERSION]: input.agentVersion,
    [ATTR_GEN_AI_PROVIDER_NAME]: input.provider,
    [ATTR_GEN_AI_REQUEST_MODEL]: input.requestModel,
    [ATTR_GEN_AI_CONVERSATION_ID]: input.conversationId,
    [ATTR_GEN_AI_DATA_SOURCE_ID]: input.dataSourceId,
    [ATTR_LOBEHUB_AGENT_OPERATION_ID]: input.operationId,
    [ATTR_LOBEHUB_AGENT_STEP_INDEX]: input.stepIndex,
  });

export interface InvokeAgentResultAttributes {
  completionReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  stepCount?: number;
}

export const buildInvokeAgentResultAttributes = (input: InvokeAgentResultAttributes): Attributes =>
  compact({
    [ATTR_GEN_AI_USAGE_INPUT_TOKENS]: input.inputTokens,
    [ATTR_GEN_AI_USAGE_OUTPUT_TOKENS]: input.outputTokens,
    [ATTR_LOBEHUB_AGENT_STEP_COUNT]: input.stepCount,
    [ATTR_LOBEHUB_AGENT_COMPLETION_REASON]: input.completionReason,
  });

export const invokeAgentSpanName = (agentName?: string) =>
  agentName ? `${GEN_AI_OPERATION_INVOKE_AGENT} ${agentName}` : GEN_AI_OPERATION_INVOKE_AGENT;

// ---- chat span ----

export interface ChatRequestAttributes {
  conversationId?: string;
  maxTokens?: number;
  operationId?: string;
  provider: string;
  requestModel: string;
  stepIndex?: number;
  stream?: boolean;
  temperature?: number;
  topP?: number;
}

export const buildChatRequestAttributes = (input: ChatRequestAttributes): Attributes =>
  compact({
    [ATTR_GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION_CHAT,
    [ATTR_GEN_AI_REQUEST_MODEL]: input.requestModel,
    [ATTR_GEN_AI_PROVIDER_NAME]: input.provider,
    [ATTR_GEN_AI_REQUEST_STREAM]: input.stream,
    [ATTR_GEN_AI_REQUEST_MAX_TOKENS]: input.maxTokens,
    [ATTR_GEN_AI_REQUEST_TEMPERATURE]: input.temperature,
    [ATTR_GEN_AI_REQUEST_TOP_P]: input.topP,
    [ATTR_GEN_AI_CONVERSATION_ID]: input.conversationId,
    [ATTR_LOBEHUB_AGENT_OPERATION_ID]: input.operationId,
    [ATTR_LOBEHUB_AGENT_STEP_INDEX]: input.stepIndex,
  });

export interface ChatResponseAttributes {
  cacheReadInputTokens?: number;
  finishReasons?: string[];
  inputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  responseId?: string;
  responseModel?: string;
  timeToFirstChunkMs?: number;
}

export const buildChatResponseAttributes = (input: ChatResponseAttributes): Attributes =>
  compact({
    [ATTR_GEN_AI_RESPONSE_ID]: input.responseId,
    [ATTR_GEN_AI_RESPONSE_MODEL]: input.responseModel,
    [ATTR_GEN_AI_RESPONSE_FINISH_REASONS]: input.finishReasons,
    [ATTR_GEN_AI_RESPONSE_TIME_TO_FIRST_CHUNK]:
      input.timeToFirstChunkMs === undefined ? undefined : input.timeToFirstChunkMs / 1000,
    [ATTR_GEN_AI_USAGE_INPUT_TOKENS]: input.inputTokens,
    [ATTR_GEN_AI_USAGE_OUTPUT_TOKENS]: input.outputTokens,
    [ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]: input.cacheReadInputTokens,
    [ATTR_GEN_AI_USAGE_REASONING_OUTPUT_TOKENS]: input.reasoningOutputTokens,
  });

export const chatSpanName = (model: string) => `${GEN_AI_OPERATION_CHAT} ${model}`;

// ---- execute_tool span ----

/**
 * `gen_ai.tool.type` value. Spec examples include `function`, `extension`,
 * and `datastore`; kept as a string because the OTel enum is open.
 */
export type ToolType = string;

export interface ExecuteToolAttributes {
  argumentsJson?: string;
  description?: string;
  operationId?: string;
  stepIndex?: number;
  toolCallId?: string;
  toolName: string;
  toolSource?: string;
  toolType?: ToolType;
}

export const buildExecuteToolAttributes = (input: ExecuteToolAttributes): Attributes =>
  compact({
    [ATTR_GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION_EXECUTE_TOOL,
    [ATTR_GEN_AI_TOOL_NAME]: input.toolName,
    [ATTR_GEN_AI_TOOL_TYPE]: input.toolType,
    [ATTR_GEN_AI_TOOL_CALL_ID]: input.toolCallId,
    [ATTR_GEN_AI_TOOL_DESCRIPTION]: input.description,
    [ATTR_GEN_AI_TOOL_CALL_ARGUMENTS]: input.argumentsJson,
    [ATTR_LOBEHUB_TOOL_SOURCE]: input.toolSource,
    [ATTR_LOBEHUB_AGENT_OPERATION_ID]: input.operationId,
    [ATTR_LOBEHUB_AGENT_STEP_INDEX]: input.stepIndex,
  });

export interface ExecuteToolResultAttributes {
  attempts?: number;
  resultJson?: string;
  success: boolean;
}

export const buildExecuteToolResultAttributes = (input: ExecuteToolResultAttributes): Attributes =>
  compact({
    [ATTR_LOBEHUB_TOOL_SUCCESS]: input.success,
    [ATTR_LOBEHUB_TOOL_ATTEMPTS]: input.attempts,
    [ATTR_GEN_AI_TOOL_CALL_RESULT]: input.resultJson,
  });

export const executeToolSpanName = (toolName: string) =>
  `${GEN_AI_OPERATION_EXECUTE_TOOL} ${toolName}`;

// ---- context_engineering span (LobeHub-only) ----

export interface ContextEngineeringAttributes {
  hasImages?: boolean;
  historyCompressed?: boolean;
  knowledgeCount?: number;
  knowledgeInjected?: boolean;
  memoryInjected?: boolean;
  messageCount?: number;
  operationId?: string;
  stepIndex?: number;
  systemRoleLength?: number;
  tokenUsage?: number;
  toolCount?: number;
  windowRatio?: number;
}

export const buildContextEngineeringAttributes = (
  input: ContextEngineeringAttributes,
): Attributes =>
  compact({
    [ATTR_LOBEHUB_CONTEXT_MESSAGE_COUNT]: input.messageCount,
    [ATTR_LOBEHUB_CONTEXT_TOKEN_USAGE]: input.tokenUsage,
    [ATTR_LOBEHUB_CONTEXT_WINDOW_RATIO]: input.windowRatio,
    [ATTR_LOBEHUB_CONTEXT_KNOWLEDGE_INJECTED]: input.knowledgeInjected,
    [ATTR_LOBEHUB_CONTEXT_KNOWLEDGE_COUNT]: input.knowledgeCount,
    [ATTR_LOBEHUB_CONTEXT_HISTORY_COMPRESSED]: input.historyCompressed,
    [ATTR_LOBEHUB_CONTEXT_MEMORY_INJECTED]: input.memoryInjected,
    [ATTR_LOBEHUB_CONTEXT_SYSTEM_ROLE_LENGTH]: input.systemRoleLength,
    [ATTR_LOBEHUB_CONTEXT_TOOL_COUNT]: input.toolCount,
    [ATTR_LOBEHUB_CONTEXT_HAS_IMAGES]: input.hasImages,
    [ATTR_LOBEHUB_AGENT_OPERATION_ID]: input.operationId,
    [ATTR_LOBEHUB_AGENT_STEP_INDEX]: input.stepIndex,
  });

export const CONTEXT_ENGINEERING_SPAN_NAME = 'context_engineering' as const;
