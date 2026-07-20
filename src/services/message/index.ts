import {
  type ChatMessageError,
  type ChatMessagePluginError,
  type ChatTranslate,
  type ChatTTS,
  type CreateMessageParams,
  type CreateMessageResult,
  type HeterogeneousToolStateSnapshot,
  type MessageMetadata,
  type MessagePluginItem,
  type ModelRankItem,
  type UIChatMessage,
  type UpdateMessageParams,
  type UpdateMessageRAGParams,
  type UpdateMessageResult,
} from '@lobechat/types';
import { type HeatmapsProps } from '@lobehub/charts';

import { lambdaClient } from '@/libs/trpc/client';

import { abortableRequest } from '../utils/abortableRequest';

/**
 * Query context for message operations
 * Contains identifiers needed for querying/filtering messages after mutations
 */
export interface MessageQueryContext {
  agentId?: string;
  groupId?: string;
  threadId?: string | null;
  topicId?: string | null;
  topicShareId?: string;
}

interface MessageReadQueryContext {
  agentId?: string | null;
  groupId?: string | null;
  /**
   * Skip the Work-summary assembly on the server — set by mid-stream
   * refetches (tool_end / step_complete) so each tool round doesn't re-run
   * the per-type Work queries. See `QueryMessageParams.skipWorks`.
   */
  skipWorks?: boolean;
  threadId?: string | null;
  topicId?: string | null;
  topicShareId?: string;
}

export type MessageBatchOperation =
  | {
      message: CreateMessageParams;
      type: 'createMessage';
    }
  | {
      id: string;
      type: 'updateMessage';
      value: Partial<UpdateMessageParams>;
    }
  | {
      id: string;
      type: 'updateToolMessage';
      value: {
        content?: string;
        heterogeneousToolState?: HeterogeneousToolStateSnapshot;
        metadata?: Record<string, any>;
        pluginError?: any;
        pluginState?: Record<string, any>;
      };
    };

export interface MessageBatchMutationResult {
  results?: Array<{
    error?: string;
    id?: string;
    index: number;
    success: boolean;
    type: MessageBatchOperation['type'];
  }>;
  success?: boolean;
}

export class MessageBatchMutationError extends Error {
  constructor(public readonly result: MessageBatchMutationResult) {
    const failed = result.results?.filter((item) => !item.success) ?? [];
    const reasons = [...new Set(failed.map((item) => item.error).filter(Boolean))];
    super(
      `Message batch mutation failed for ${failed.length || 'unknown'} operation(s)` +
        (reasons.length > 0 ? `: ${reasons.join('; ')}` : ''),
    );
  }
}

const getBatchMutationAbortKey = (operations: MessageBatchOperation[]) => {
  if (operations.length !== 1) return;

  const [operation] = operations;
  if (operation.type === 'updateToolMessage') return `tool-message-${operation.id}`;
};

export class MessageService {
  batchMutate = async (operations: MessageBatchOperation[], signal?: AbortSignal) => {
    const input = {
      operations: operations.map((operation) => {
        if (operation.type === 'createMessage') {
          return {
            message: operation.message,
            type: operation.type,
          };
        }

        return {
          id: operation.id,
          type: operation.type,
          value: operation.value,
        };
      }),
    } as any;

    return signal
      ? lambdaClient.message.batchMutate.mutate(input, { signal })
      : lambdaClient.message.batchMutate.mutate(input);
  };

  batchMutateOrThrow = async (operations: MessageBatchOperation[]) => {
    const execute = async (signal?: AbortSignal) => {
      const result = (await (signal
        ? this.batchMutate(operations, signal)
        : this.batchMutate(operations))) as MessageBatchMutationResult;
      const hasFailedOperation = result.results?.some((item) => !item.success) ?? false;
      const hasCompleteResults = result.results?.length === operations.length;

      if (result.success !== true || !hasCompleteResults || hasFailedOperation) {
        throw new MessageBatchMutationError(result);
      }

      return result;
    };

    const abortKey = getBatchMutationAbortKey(operations);

    return abortKey ? abortableRequest.execute(abortKey, execute) : execute();
  };

  createMessage = async (params: CreateMessageParams): Promise<CreateMessageResult> => {
    return lambdaClient.message.createMessage.mutate(params as any);
  };

  getMessages = async (params: MessageReadQueryContext): Promise<UIChatMessage[]> => {
    const data = await lambdaClient.message.getMessages.query(params);

    return data as unknown as UIChatMessage[];
  };

  diagnoseTopic = async (params: { agentId?: string | null; topicId: string }) => {
    return lambdaClient.message.diagnoseTopic.query(params);
  };

  repairTopic = async (params: { agentId?: string | null; topicId: string }) => {
    return lambdaClient.message.repairTopic.mutate(params);
  };

  countMessages = async (params?: {
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number> => {
    return lambdaClient.message.count.query(params);
  };

  countWords = async (params?: {
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number> => {
    return lambdaClient.message.countWords.query(params);
  };

  rankModels = async (): Promise<ModelRankItem[]> => {
    return lambdaClient.message.rankModels.query();
  };

  getHeatmaps = async (): Promise<HeatmapsProps['data']> => {
    return lambdaClient.message.getHeatmaps.query();
  };

  getTokenHeatmaps = async (): Promise<HeatmapsProps['data']> => {
    return lambdaClient.message.getTokenHeatmaps.query();
  };

  updateMessageError = async (id: string, value: ChatMessageError, ctx?: MessageQueryContext) => {
    const error = value.type
      ? value
      : { body: value, message: value.message, type: 'ApplicationRuntimeError' };

    return lambdaClient.message.update.mutate({
      ...ctx,
      id,
      value: { error },
    });
  };

  updateMessagePluginArguments = async (id: string, value: string | Record<string, any>) => {
    const args = typeof value === 'string' ? value : JSON.stringify(value);
    return lambdaClient.message.updateMessagePlugin.mutate({ id, value: { arguments: args } });
  };

  /**
   * Update tool arguments by toolCallId - updates both tool message and parent assistant message in one transaction
   * This is the preferred method for updating tool arguments as it prevents race conditions
   *
   * @param toolCallId - The tool call ID (stable identifier from AI response)
   * @param value - The new arguments value
   * @param ctx - Message query context
   */
  updateToolArguments = async (
    toolCallId: string,
    value: string | Record<string, unknown>,
    ctx?: MessageQueryContext,
  ) => {
    return lambdaClient.message.updateToolArguments.mutate({ ...ctx, toolCallId, value });
  };

  updateMessage = async (
    id: string,
    value: Partial<UpdateMessageParams>,
    ctx?: MessageQueryContext,
  ): Promise<UpdateMessageResult> => {
    return lambdaClient.message.update.mutate({
      ...ctx,
      id,
      value,
    });
  };

  updateMessageTranslate = async (id: string, translate: Partial<ChatTranslate> | false) => {
    return lambdaClient.message.updateTranslate.mutate({ id, value: translate as ChatTranslate });
  };

  updateMessageTTS = async (id: string, tts: Partial<ChatTTS> | false) => {
    return lambdaClient.message.updateTTS.mutate({ id, value: tts });
  };

  updateMessageMetadata = async (
    id: string,
    value: Partial<MessageMetadata>,
    ctx?: MessageQueryContext,
  ): Promise<UpdateMessageResult> => {
    return abortableRequest.execute(`message-metadata-${id}`, (signal) =>
      lambdaClient.message.updateMetadata.mutate({ ...ctx, id, value }, { signal }),
    );
  };

  updateMessagePluginState = async (
    id: string,
    value: Record<string, any>,
    ctx?: MessageQueryContext,
  ): Promise<UpdateMessageResult> => {
    return lambdaClient.message.updatePluginState.mutate({ ...ctx, id, value });
  };

  updateMessagePluginError = async (
    id: string,
    error: ChatMessagePluginError | null,
    ctx?: MessageQueryContext,
  ): Promise<UpdateMessageResult> => {
    return lambdaClient.message.updatePluginError.mutate({ ...ctx, id, value: error as any });
  };

  updateMessagePlugin = async (
    id: string,
    value: Partial<Omit<MessagePluginItem, 'id'>>,
    ctx?: MessageQueryContext,
  ): Promise<UpdateMessageResult> => {
    return lambdaClient.message.updateMessagePlugin.mutate({ ...ctx, id, value });
  };

  updateMessageRAG = async (
    id: string,
    data: UpdateMessageRAGParams,
    ctx?: MessageQueryContext,
  ): Promise<UpdateMessageResult> => {
    return lambdaClient.message.updateMessageRAG.mutate({ ...ctx, id, value: data });
  };

  /**
   * Update tool message with content, metadata, pluginState, and pluginError in a single request
   * This prevents race conditions when updating multiple fields
   * Uses abortableRequest to cancel previous requests for the same message
   */
  updateToolMessage = async (
    id: string,
    value: {
      content?: string;
      heterogeneousToolState?: HeterogeneousToolStateSnapshot;
      metadata?: Record<string, any>;
      pluginError?: any;
      pluginState?: Record<string, any>;
    },
    ctx?: MessageQueryContext,
  ): Promise<UpdateMessageResult> => {
    return abortableRequest.execute(`tool-message-${id}`, (signal) =>
      lambdaClient.message.updateToolMessage.mutate({ ...ctx, id, value }, { signal }),
    );
  };

  removeMessage = async (id: string, ctx?: MessageQueryContext): Promise<UpdateMessageResult> => {
    return lambdaClient.message.removeMessage.mutate({ ...ctx, id });
  };

  removeMessages = async (
    ids: string[],
    ctx?: MessageQueryContext,
  ): Promise<UpdateMessageResult> => {
    return lambdaClient.message.removeMessages.mutate({ ...ctx, ids });
  };

  removeMessagesByAssistant = async (sessionId: string, topicId?: string) => {
    return lambdaClient.message.removeMessagesByAssistant.mutate({ sessionId, topicId });
  };

  removeMessagesByGroup = async (groupId: string, topicId?: string) => {
    return lambdaClient.message.removeMessagesByGroup.mutate({ groupId, topicId });
  };

  /**
   * Add files to a message
   * Used to associate exported files from code interpreter with the tool message
   */
  addFilesToMessage = async (
    id: string,
    fileIds: string[],
    ctx?: MessageQueryContext,
  ): Promise<UpdateMessageResult> => {
    return lambdaClient.message.addFilesToMessage.mutate({ ...ctx, fileIds, id });
  };

  // =============== Compression ===============

  /**
   * Create a compression group for old messages
   * Returns placeholder group and messages to summarize
   */
  createCompressionGroup = async (params: {
    agentId: string;
    groupId?: string | null;
    messageIds: string[];
    threadId?: string | null;
    topicId: string;
  }): Promise<{
    messageGroupId: string;
    messages: UIChatMessage[];
    messagesToSummarize: UIChatMessage[];
  }> => {
    const result = await lambdaClient.message.createCompressionGroup.mutate(params);
    return {
      messageGroupId: result.messageGroupId,
      messages: (result.messages || []) as unknown as UIChatMessage[],
      messagesToSummarize: (result.messagesToSummarize || []) as unknown as UIChatMessage[],
    };
  };

  /**
   * Finalize compression by updating group with generated summary
   */
  finalizeCompression = async (params: {
    agentId: string;
    content: string;
    groupId?: string | null;
    messageGroupId: string;
    sourceGroupIds?: string[];
    threadId?: string | null;
    topicId: string;
  }): Promise<{ messages?: UIChatMessage[] }> => {
    const result = await lambdaClient.message.finalizeCompression.mutate(params);
    return {
      messages: (result.messages || []) as unknown as UIChatMessage[],
    };
  };

  /**
   * Update message group metadata (e.g., expanded state)
   */
  updateMessageGroupMetadata = async (params: {
    context: {
      agentId: string;
      groupId?: string | null;
      threadId?: string | null;
      topicId: string;
    };
    expanded?: boolean;
    messageGroupId: string;
  }): Promise<{ messages: UIChatMessage[] }> => {
    const result = await lambdaClient.message.updateMessageGroupMetadata.mutate(params);
    return {
      messages: (result.messages || []) as unknown as UIChatMessage[],
    };
  };

  /**
   * Cancel compression by deleting the compression group and restoring original messages
   */
  cancelCompression = async (params: {
    agentId: string;
    groupId?: string | null;
    messageGroupId: string;
    threadId?: string | null;
    topicId: string;
  }): Promise<{ messages: UIChatMessage[] }> => {
    const result = await lambdaClient.message.cancelCompression.mutate(params);
    return { messages: (result.messages || []) as unknown as UIChatMessage[] };
  };
}

export const messageService = new MessageService();
