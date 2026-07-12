import type {
  ChatToolPayload,
  MessageMetadata,
  MessageToolCall,
  ModelPerformance,
  ModelReasoning,
  ModelUsage,
} from '@lobechat/types';
import { serializePartsForStorage } from '@lobechat/utils/multimodalContent';
import { sanitizeToolCallArguments } from '@lobechat/utils/sanitizeToolCallArguments';

import { UsageCounter } from '../core/UsageCounter';
import type { AgentRuntimeHost, LLMAttemptOutput } from '../transport';
import type {
  AgentEvent,
  AgentState,
  GeneralAgentCallLLMResultPayload,
  InstructionExecutionResult,
} from '../types';

export const VISIBLE_OUTPUT_END_PUBLISHED_STEP_INDEX_METADATA_KEY =
  'visibleOutputEndPublishedStepIndex';

type CallLlmCollectedOutput = Pick<
  LLMAttemptOutput,
  | 'content'
  | 'contentParts'
  | 'hasContentImages'
  | 'hasReasoningImages'
  | 'reasoningParts'
  | 'thinkingContent'
>;

interface CallLlmMessageMetadata extends MessageMetadata {
  answerSalvagedFromReasoning?: boolean;
  interruptedMidStream?: boolean;
}

interface FinalizeCallLlmTurnInput {
  assistantMessageId: string;
  events: AgentEvent[];
  host: AgentRuntimeHost;
  model: string;
  output: LLMAttemptOutput;
  provider: string;
  recordResult?: (output: LLMAttemptOutput) => Promise<void> | void;
  shouldReplayAssistantReasoning: boolean;
  state: AgentState;
  stepLabel?: string;
}

interface PersistInterruptedCallLlmResultInput {
  assistantMessageId: string;
  host: AgentRuntimeHost;
  output: LLMAttemptOutput;
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
}): CallLlmMessageMetadata | undefined => {
  const metadata: CallLlmMessageMetadata = {
    ...(currentStepUsage && { ...currentStepUsage, usage: currentStepUsage }),
    ...(currentStepSpeed && { ...currentStepSpeed, performance: currentStepSpeed }),
    ...(hasContentImages && { isMultimodal: true }),
    ...(answerSalvagedFromReasoning && { answerSalvagedFromReasoning: true }),
    ...(interruptedMidStream && { interruptedMidStream: true }),
  };

  return Object.keys(metadata).length > 0 ? metadata : undefined;
};

const buildFinalReasoning = (output: CallLlmCollectedOutput): ModelReasoning | undefined => {
  if (output.hasReasoningImages) {
    return {
      content: serializePartsForStorage(output.reasoningParts),
      isMultimodal: true,
    };
  }

  return output.thinkingContent ? { content: output.thinkingContent } : undefined;
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

const persistFinalMessage = async ({
  assistantMessageId,
  host,
  output,
}: Pick<FinalizeCallLlmTurnInput, 'assistantMessageId' | 'host' | 'output'>) => {
  const finalContent = output.hasContentImages
    ? serializePartsForStorage(output.contentParts)
    : output.content;
  const finalReasoning = buildFinalReasoning(output);
  const metadata = buildMessageMetadata({
    answerSalvagedFromReasoning: output.answerSalvagedFromReasoning,
    currentStepSpeed: output.speed,
    currentStepUsage: output.usage,
    hasContentImages: output.hasContentImages,
  });

  try {
    await host.transports.messages.update(assistantMessageId, {
      content: finalContent,
      imageList: output.imageList.length > 0 ? output.imageList : undefined,
      metadata,
      reasoning: finalReasoning,
      search: output.grounding,
      tools: sanitizePersistedTools(output.toolsCalling),
    });
  } catch (error) {
    console.error('[call_llm] Failed to update message:', error);
  }

  return finalReasoning;
};

const buildFinalState = ({
  assistantMessageId,
  model,
  output,
  provider,
  shouldReplayAssistantReasoning,
  state,
  stepLabel,
  visibleOutputEndPublishedStepIndex,
  finalReasoning,
}: Omit<FinalizeCallLlmTurnInput, 'events' | 'host' | 'recordResult'> & {
  finalReasoning?: ModelReasoning;
  visibleOutputEndPublishedStepIndex?: number;
}): AgentState => {
  const newState = structuredClone(state);
  newState.messages.push({
    content: output.content,
    id: assistantMessageId,
    reasoning: shouldReplayAssistantReasoning ? finalReasoning : undefined,
    role: 'assistant',
    tool_calls: sanitizeStateToolCalls(output.toolCalls),
  });

  if (output.usage) {
    const { usage, cost } = UsageCounter.accumulateLLM({
      cost: newState.cost,
      model,
      modelUsage: output.usage,
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

export const finalizeCallLlmTurn = async ({
  assistantMessageId,
  events,
  host,
  model,
  output,
  provider,
  recordResult,
  shouldReplayAssistantReasoning,
  state,
  stepLabel,
}: FinalizeCallLlmTurnInput): Promise<InstructionExecutionResult> => {
  const { operation, transports } = host;

  events.push({
    result: {
      content: output.content,
      finishReason: output.finishReason,
      reasoning: output.thinkingContent,
      tool_calls: output.toolCalls,
      usage: output.usage,
    },
    type: 'llm_result',
  });

  await transports.stream.publishEvent({
    data: {
      finalContent: output.content,
      grounding: output.grounding,
      ...(stepLabel && { stepLabel }),
      imageList: output.imageList.length > 0 ? output.imageList : undefined,
      reasoning: output.thinkingContent || undefined,
      toolsCalling: output.toolsCalling,
      usage: output.usage,
    },
    stepIndex: operation.stepIndex,
    type: 'stream_end',
  });

  let visibleOutputEndPublishedStepIndex: number | undefined;
  const canPublishEarlyFinalAnswerVisibleEnd =
    operation.allowEarlyFinalAnswerVisibleOutputEnd ?? true;
  if (
    canPublishEarlyFinalAnswerVisibleEnd &&
    output.toolsCalling.length === 0 &&
    output.toolCalls.length === 0
  ) {
    try {
      await transports.stream.publishEvent({
        data: { reason: 'final_answer' },
        stepIndex: operation.stepIndex,
        type: 'visible_output_end',
      });
      visibleOutputEndPublishedStepIndex = operation.stepIndex;
    } catch (error) {
      console.error('Failed to publish visible_output_end:', error);
    }
  }

  const finalReasoning = await persistFinalMessage({ assistantMessageId, host, output });
  const newState = buildFinalState({
    assistantMessageId,
    finalReasoning,
    model,
    output,
    provider,
    shouldReplayAssistantReasoning,
    state,
    stepLabel,
    visibleOutputEndPublishedStepIndex,
  });

  await recordResult?.(output);

  return {
    events,
    newState,
    nextContext: {
      payload: {
        hasToolsCalling: output.toolsCalling.length > 0,
        parentMessageId: assistantMessageId,
        result: { content: output.content, tool_calls: output.toolCalls },
        toolsCalling: output.toolsCalling,
      } as GeneralAgentCallLLMResultPayload,
      phase: 'llm_result',
      session: {
        eventCount: events.length,
        messageCount: newState.messages.length,
        sessionId: operation.operationId,
        status: 'running',
        stepCount: state.stepCount + 1,
      },
      stepUsage: output.usage,
    },
  };
};

export const persistInterruptedCallLlmResult = async ({
  assistantMessageId,
  host,
  output,
}: PersistInterruptedCallLlmResultInput): Promise<void> => {
  if (!output.content && !output.thinkingContent && output.toolsCalling.length === 0) return;

  try {
    await host.transports.messages.update(assistantMessageId, {
      content: output.content,
      metadata: buildMessageMetadata({
        currentStepSpeed: output.speed,
        currentStepUsage: output.usage,
        interruptedMidStream: true,
      }),
      reasoning: output.thinkingContent ? { content: output.thinkingContent } : undefined,
      tools: sanitizePersistedTools(output.toolsCalling),
    });
  } catch (error) {
    console.error('[call_llm] Failed to persist interrupted output:', error);
  }
};
