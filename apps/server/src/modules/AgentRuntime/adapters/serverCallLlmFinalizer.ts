import { type AgentState, UsageCounter } from '@lobechat/agent-runtime';
import type {
  ChatImageItem,
  ChatToolPayload,
  GroundingSearch,
  MessageMetadata,
  MessageToolCall,
  ModelPerformance,
  ModelReasoning,
  ModelUsage,
} from '@lobechat/types';
import { sanitizeToolCallArguments, serializePartsForStorage } from '@lobechat/utils';

import type { RuntimeExecutorContext } from '../context';
import { log } from '../executorHelpers';
import { VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY } from '../visibleOutputEnd';
import type { ServerCallLlmStreamSink } from './serverCallLlmStreamSink';

type ServerCallLlmCollectedOutput = Pick<
  ServerCallLlmStreamSink,
  | 'content'
  | 'contentParts'
  | 'hasContentImages'
  | 'hasReasoningImages'
  | 'reasoningParts'
  | 'thinkingContent'
>;

interface ServerCallLlmMessageMetadata extends MessageMetadata {
  answerSalvagedFromReasoning?: boolean;
  interruptedMidStream?: boolean;
}

interface FinalizeServerCallLlmResultInput {
  answerSalvagedFromReasoning: boolean;
  assistantMessageId: string;
  currentStepSpeed?: ModelPerformance;
  currentStepUsage?: ModelUsage;
  grounding: GroundingSearch | null;
  imageList: ChatImageItem[];
  messageModel: RuntimeExecutorContext['messageModel'];
  model: string;
  provider: string;
  shouldReplayAssistantReasoning: boolean;
  state: AgentState;
  stepLabel?: string;
  streamOutput: ServerCallLlmCollectedOutput;
  toolCalls: MessageToolCall[];
  toolsCalling: ChatToolPayload[];
  visibleOutputEndPublishedStepIndex?: number;
}

interface PersistInterruptedServerCallLlmResultInput {
  assistantMessageId: string;
  currentStepSpeed?: ModelPerformance;
  currentStepUsage?: ModelUsage;
  messageModel: RuntimeExecutorContext['messageModel'];
  operationLogId: string;
  streamOutput: ServerCallLlmCollectedOutput;
  toolsCalling: ChatToolPayload[];
}

const buildMessageMetadata = ({
  answerSalvagedFromReasoning,
  currentStepSpeed,
  currentStepUsage,
  hasContentImages,
  interruptedMidStream,
}: {
  answerSalvagedFromReasoning?: boolean;
  currentStepSpeed?: ModelPerformance;
  currentStepUsage?: ModelUsage;
  hasContentImages?: boolean;
  interruptedMidStream?: boolean;
}): ServerCallLlmMessageMetadata | undefined => {
  const metadata: ServerCallLlmMessageMetadata = {
    ...(currentStepUsage && { ...currentStepUsage, usage: currentStepUsage }),
    ...(currentStepSpeed && { ...currentStepSpeed, performance: currentStepSpeed }),
    ...(hasContentImages && { isMultimodal: true }),
    ...(answerSalvagedFromReasoning && { answerSalvagedFromReasoning: true }),
    ...(interruptedMidStream && { interruptedMidStream: true }),
  };

  return Object.keys(metadata).length > 0 ? metadata : undefined;
};

const buildFinalReasoning = (
  streamOutput: ServerCallLlmCollectedOutput,
): ModelReasoning | undefined => {
  if (streamOutput.hasReasoningImages) {
    return {
      content: serializePartsForStorage(streamOutput.reasoningParts),
      isMultimodal: true,
    };
  }

  return streamOutput.thinkingContent ? { content: streamOutput.thinkingContent } : undefined;
};

const sanitizePersistedTools = (toolsCalling: ChatToolPayload[]) =>
  toolsCalling.length > 0
    ? toolsCalling.map((tool) => ({
        ...tool,
        arguments: sanitizeToolCallArguments(tool.arguments),
      }))
    : undefined;

const sanitizeStateToolCalls = (toolCalls: MessageToolCall[]) => {
  const sanitizedToolCalls = toolCalls
    .filter((toolCall) => !!toolCall.function.name)
    .map((toolCall) => ({
      ...toolCall,
      function: {
        ...toolCall.function,
        arguments: sanitizeToolCallArguments(toolCall.function.arguments),
      },
    }));

  return sanitizedToolCalls.length > 0 ? sanitizedToolCalls : undefined;
};

export const finalizeServerCallLlmResult = async ({
  answerSalvagedFromReasoning,
  assistantMessageId,
  currentStepSpeed,
  currentStepUsage,
  grounding,
  imageList,
  messageModel,
  model,
  provider,
  shouldReplayAssistantReasoning,
  state,
  stepLabel,
  streamOutput,
  toolCalls,
  toolsCalling,
  visibleOutputEndPublishedStepIndex,
}: FinalizeServerCallLlmResultInput): Promise<AgentState> => {
  const finalContent = streamOutput.hasContentImages
    ? serializePartsForStorage(streamOutput.contentParts)
    : streamOutput.content;
  const finalReasoning = buildFinalReasoning(streamOutput);
  const metadata = buildMessageMetadata({
    answerSalvagedFromReasoning,
    currentStepSpeed,
    currentStepUsage,
    hasContentImages: streamOutput.hasContentImages,
  });

  try {
    await messageModel.update(assistantMessageId, {
      content: finalContent,
      imageList: imageList.length > 0 ? imageList : undefined,
      metadata,
      reasoning: finalReasoning,
      search: grounding,
      tools: sanitizePersistedTools(toolsCalling),
    });
  } catch (error) {
    console.error('[call_llm] Failed to update message:', error);
  }

  const newState = structuredClone(state);
  newState.messages.push({
    content: streamOutput.content,
    id: assistantMessageId,
    reasoning: shouldReplayAssistantReasoning ? finalReasoning : undefined,
    role: 'assistant',
    tool_calls: sanitizeStateToolCalls(toolCalls),
  });

  if (currentStepUsage) {
    const { usage, cost } = UsageCounter.accumulateLLM({
      cost: newState.cost,
      model,
      modelUsage: currentStepUsage,
      provider,
      usage: newState.usage,
    });

    newState.usage = usage;
    if (cost) newState.cost = cost;
  }

  if (stepLabel || visibleOutputEndPublishedStepIndex !== undefined) {
    const stateMetadata = { ...newState.metadata };
    if (stepLabel) stateMetadata._stepLabel = stepLabel;
    if (visibleOutputEndPublishedStepIndex !== undefined) {
      stateMetadata[VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY] =
        visibleOutputEndPublishedStepIndex;
    }
    newState.metadata = stateMetadata;
  }

  return newState;
};

export const persistInterruptedServerCallLlmResult = async ({
  assistantMessageId,
  currentStepSpeed,
  currentStepUsage,
  messageModel,
  operationLogId,
  streamOutput,
  toolsCalling,
}: PersistInterruptedServerCallLlmResultInput): Promise<void> => {
  if (!streamOutput.content && !streamOutput.thinkingContent && toolsCalling.length === 0) return;

  try {
    await messageModel.update(assistantMessageId, {
      content: streamOutput.content,
      metadata: buildMessageMetadata({
        currentStepSpeed,
        currentStepUsage,
        interruptedMidStream: true,
      }),
      reasoning: streamOutput.thinkingContent
        ? { content: streamOutput.thinkingContent }
        : undefined,
      tools: sanitizePersistedTools(toolsCalling),
    });
    log(
      '[%s] Interrupted finalize: persisted partial content (c=%d r=%d tools=%d)',
      operationLogId,
      streamOutput.content.length,
      streamOutput.thinkingContent.length,
      toolsCalling.length,
    );
  } catch (error) {
    log('[%s] Interrupted finalize update failed: %O', operationLogId, error);
  }
};
