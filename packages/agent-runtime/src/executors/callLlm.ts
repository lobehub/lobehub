import type { AgentRuntimeHost, LLMCallExecuteInput } from '../transport';
import type { AgentInstruction, CallLLMPayload, InstructionExecutor } from '../types';

const CONVERSATION_PARENT_MISSING_ERROR_TYPE = 'ConversationParentMissing';

interface LLMCallTransport {
  executeCall: (input: LLMCallExecuteInput) => ReturnType<InstructionExecutor>;
}

const requireLLMCallTransport = (host: AgentRuntimeHost) => {
  const llm = host.transports.llm;
  if (!llm?.executeCall) {
    throw new Error('LLMTransport.executeCall is required for call_llm executor');
  }
  return llm as NonNullable<AgentRuntimeHost['transports']['llm']> & LLMCallTransport;
};

const createConversationParentMissingError = (parentId: string) => {
  const error = new Error(
    `Conversation parent message ${parentId} no longer exists. It was likely deleted while the operation was running.`,
  );
  Object.assign(error, {
    errorType: CONVERSATION_PARENT_MISSING_ERROR_TYPE,
    parentId,
  });
  return error;
};

const formatErrorEventData = (error: Error & { errorType?: unknown }, phase: string) => ({
  error: error.message,
  errorType: typeof error.errorType === 'string' ? error.errorType : error.name,
  phase,
});

const pickSeedField = (source: object, key: string) => {
  const value = (source as Record<string, unknown>)[key];
  return value === undefined ? undefined : value;
};

const buildAssistantMessageSeed = (
  assistantMessage: { id: string },
  seed: object = assistantMessage,
) => ({
  id: assistantMessage.id,
  ...(pickSeedField(seed, 'agentId') !== undefined && {
    agentId: pickSeedField(seed, 'agentId'),
  }),
  ...(pickSeedField(seed, 'groupId') !== undefined && {
    groupId: pickSeedField(seed, 'groupId'),
  }),
  ...(pickSeedField(seed, 'model') !== undefined && { model: pickSeedField(seed, 'model') }),
  ...(pickSeedField(seed, 'parentId') !== undefined && {
    parentId: pickSeedField(seed, 'parentId'),
  }),
  ...(pickSeedField(seed, 'provider') !== undefined && {
    provider: pickSeedField(seed, 'provider'),
  }),
  ...(pickSeedField(seed, 'role') !== undefined && { role: pickSeedField(seed, 'role') }),
  ...(pickSeedField(seed, 'threadId') !== undefined && {
    threadId: pickSeedField(seed, 'threadId'),
  }),
  ...(pickSeedField(seed, 'topicId') !== undefined && {
    topicId: pickSeedField(seed, 'topicId'),
  }),
});

/**
 * `call_llm` executor — transitional transport-backed entry point.
 *
 * The server-specific implementation still lives behind the LLM transport while
 * the remaining context/stream/persist internals are broken into package-owned
 * ports. This removes the direct server executor registration first, matching
 * the migration shape used by the other runtime executors.
 */
export const callLlm =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state) => {
    const { operation, transports } = host;
    const llm = requireLLMCallTransport(host);
    const { payload } = instruction as Extract<AgentInstruction, { type: 'call_llm' }>;
    const llmPayload = payload as CallLLMPayload & {
      assistantMessageId?: string;
      parentMessageId?: string;
    };
    const model = llmPayload.model || state.modelRuntimeConfig?.model;
    const provider = llmPayload.provider || state.modelRuntimeConfig?.provider;

    if (!model || !provider) {
      throw new Error('Model and provider are required for call_llm instruction');
    }

    const parentId = llmPayload.parentId || llmPayload.parentMessageId;
    if (parentId) {
      const parentExists = await transports.messages.findById(parentId);
      if (!parentExists) {
        const error = createConversationParentMissingError(parentId);
        await transports.stream.publishEvent({
          data: formatErrorEventData(error, 'parent_message_preflight'),
          stepIndex: operation.stepIndex,
          type: 'error',
        });
        throw error;
      }
    }

    const existingAssistantMessageId = llmPayload.assistantMessageId;
    const assistantMessage = existingAssistantMessageId
      ? { id: existingAssistantMessageId }
      : await transports.messages.createAssistantMessage({
          agentId: state.metadata!.agentId!,
          content: '',
          groupId: state.metadata?.groupId ?? undefined,
          model,
          parentId,
          provider,
          role: 'assistant',
          threadId: state.metadata?.threadId,
          topicId: state.metadata?.topicId,
        });

    const assistantMessageSeed = existingAssistantMessageId
      ? ((await transports.messages.findById(existingAssistantMessageId)) ?? assistantMessage)
      : assistantMessage;
    const stepLabel = (instruction as { stepLabel?: string }).stepLabel;

    await transports.stream.publishEvent({
      data: {
        assistantMessage: buildAssistantMessageSeed(assistantMessage, assistantMessageSeed),
        model,
        provider,
        ...(stepLabel && { stepLabel }),
      },
      stepIndex: operation.stepIndex,
      type: 'stream_start',
    });

    return llm.executeCall({
      assistantMessage,
      instruction: instruction as Extract<AgentInstruction, { type: 'call_llm' }>,
      model,
      parentId,
      provider,
      state,
      stepLabel,
    });
  };
