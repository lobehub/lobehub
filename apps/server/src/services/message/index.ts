import { type LobeChatDatabase } from '@lobechat/database';
import { CompressionRepository } from '@lobechat/database';
import {
  type CreateMessageParams,
  type HeterogeneousToolStateSnapshot,
  type QueryMessageParams,
  type UIChatMessage,
  type UpdateMessageParams,
} from '@lobechat/types';
import { createTimingHelpers, getDurationMs } from '@lobechat/utils';

import { MessageModel } from '@/database/models/message';

import { FileService } from '../file';

interface QueryOptions {
  agentId?: string | null;
  groupId?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  timingRequestId?: string;
  timingStartedAt?: number;
  topicId?: string | null;
}

const { createPrefixedTimingContext, logTiming, toTimingContext } = createTimingHelpers(
  'lobe-server:chat:lobehub:timing',
);

const logMessageTiming = (
  options: QueryOptions | undefined,
  event: string,
  metadata?: Record<string, unknown>,
) => {
  logTiming(toTimingContext(options), event, metadata);
};

const createModelTiming = (options: QueryOptions | undefined, prefix: string) =>
  createPrefixedTimingContext(toTimingContext(options), prefix);

/**
 * Reduce a failed write to something the caller can act on. Drizzle wraps driver
 * errors in a generic `Failed query: insert into ...` whose message is the whole
 * statement plus its params — too noisy to return, and it may carry message
 * content. The driver error underneath (`cause`) holds the actionable part: the
 * SQLSTATE and the violated constraint.
 */
const describeBatchMutateError = (error: unknown): string => {
  const cause = (error as { cause?: unknown } | undefined)?.cause;
  const driverError = (cause ?? error) as
    { code?: string; constraint?: string; message?: string } | undefined;

  const detail = [driverError?.constraint, driverError?.code, driverError?.message]
    .filter(Boolean)
    .join(' | ');

  return (detail || String(error)).slice(0, 300);
};

interface CreateMessageResult {
  id: string;
  messages: any[];
}

export type MessageBatchOperation =
  | {
      message: CreateMessageParams;
      type: 'createMessage';
    }
  | {
      id: string;
      type: 'updateMessage';
      value: UpdateMessageParams;
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

/**
 * Message Service
 *
 * Encapsulates repeated "mutation + conditional query" logic.
 * After performing update/delete operations, conditionally returns message list based on sessionId/topicId.
 */
export class MessageService {
  private messageModel: MessageModel;
  private fileService: FileService;
  private compressionRepository: CompressionRepository;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.messageModel = new MessageModel(db, userId, workspaceId);
    this.fileService = new FileService(db, userId, workspaceId);
    this.compressionRepository = new CompressionRepository(db, userId, workspaceId);
  }

  /**
   * Unified URL processing function
   */
  private get postProcessUrl() {
    return (path: string | null, file: { fileType: string; id?: string | null }) =>
      this.fileService.getFileAccessUrl({ id: file.id, url: path });
  }

  /**
   * Unified query options
   */
  private getQueryOptions() {
    return {
      groupAssistantMessages: false,
      postProcessUrl: this.postProcessUrl,
    };
  }

  /**
   * Query messages and return response with success status (used after mutations)
   * Prioritize agentId, fallback to sessionId if not provided (for backwards compatibility)
   */
  private async queryWithSuccess(
    options?: QueryOptions,
  ): Promise<{ messages?: UIChatMessage[]; success: boolean }> {
    if (
      !options ||
      (options.agentId === undefined &&
        options.sessionId === undefined &&
        options.topicId === undefined)
    ) {
      logMessageTiming(options, 'lambda.message.update.queryMessages:skipped');
      return { success: true };
    }

    const { agentId, sessionId, topicId, groupId, threadId } = options;

    const queryStartedAt = Date.now();
    const modelTiming = createModelTiming(options, 'lambda.message.update.queryMessages');
    const messages = await this.messageModel.query(
      { agentId, groupId, sessionId, threadId, topicId },
      {
        ...this.getQueryOptions(),
        ...(modelTiming ? { timing: modelTiming } : {}),
      },
    );
    logMessageTiming(options, 'lambda.message.update.queryMessages:done', {
      messageCount: messages.length,
      stageMs: getDurationMs(queryStartedAt),
    });

    return { messages, success: true };
  }

  /**
   * Fetch the canonical message list for an agent / topic scope, using the
   * standard UIChatMessage shape (file URLs resolved through FileService).
   *
   * Mirrors the read path exposed by the `message.getMessages` trpc lambda
   * so server-internal callers (e.g. agent runtime stream events) can push
   * the same payload the client would otherwise fetch.
   */
  async queryMessages(params: QueryMessageParams): Promise<UIChatMessage[]> {
    return this.messageModel.query(params, this.getQueryOptions());
  }

  /**
   * Quiet write-behind batch for streaming runtimes. Unlike createMessage /
   * updateMessage, this intentionally does not query the full message list after
   * each write; callers flush before reconciliation boundaries themselves.
   */
  async batchMutate(operations: MessageBatchOperation[]): Promise<{
    results: {
      error?: string;
      id?: string;
      index: number;
      success: boolean;
      type: MessageBatchOperation['type'];
    }[];
    success: boolean;
  }> {
    const results: {
      error?: string;
      id?: string;
      index: number;
      success: boolean;
      type: MessageBatchOperation['type'];
    }[] = [];

    for (const [index, operation] of operations.entries()) {
      try {
        if (operation.type === 'createMessage') {
          const item = await this.messageModel.create(operation.message, operation.message.id);
          results.push({ id: item.id, index, success: true, type: operation.type });
          continue;
        }

        if (operation.type === 'updateToolMessage') {
          const result = await this.messageModel.updateToolMessage(operation.id, operation.value);
          results.push({ id: operation.id, index, success: result.success, type: operation.type });
          continue;
        }

        const result = await this.messageModel.update(operation.id, operation.value as any);
        results.push({ id: operation.id, index, success: result.success, type: operation.type });
      } catch (error) {
        console.error('[MessageService] batchMutate operation failed:', error);
        results.push({
          error: describeBatchMutateError(error),
          id: operation.type === 'createMessage' ? operation.message.id : operation.id,
          index,
          success: false,
          type: operation.type,
        });
      }
    }

    return { results, success: results.every((result) => result.success) };
  }

  /**
   * Create a new message and return the complete message list
   * Pattern: create + query
   *
   * This method combines message creation and querying into a single operation,
   * reducing the need for separate refresh calls and improving performance.
   */
  async createMessage(params: CreateMessageParams): Promise<CreateMessageResult> {
    // 1. Create the message (using agentId). Honor a caller-pre-allocated id
    //    when present (passing `undefined` falls back to the model's genId
    //    default), so flows that chain parentId across not-yet-created messages
    //    (e.g. the subagent run coordinator) can assign ids up front.
    const item = await this.messageModel.create(params, params.id);

    // 2. Query all messages for this agent/topic
    // Use agentId field for query
    const messages = await this.messageModel.query(
      {
        agentId: params.agentId,
        current: 0,
        groupId: params.groupId,
        pageSize: 9999,
        threadId: params.threadId,
        topicId: params.topicId,
      },
      {
        postProcessUrl: this.postProcessUrl,
      },
    );

    // 3. Return the result
    return {
      id: item.id,
      messages,
    };
  }

  /**
   * Remove messages with optional message list return
   * Pattern: delete + conditional query
   */
  async removeMessages(ids: string[], options?: QueryOptions) {
    await this.messageModel.deleteMessages(ids);
    return this.queryWithSuccess(options);
  }

  /**
   * Remove single message with optional message list return
   * Pattern: delete + conditional query
   */
  async removeMessage(id: string, options?: QueryOptions) {
    await this.messageModel.deleteMessage(id);
    return this.queryWithSuccess(options);
  }

  /**
   * Update message RAG with optional message list return
   * Pattern: update + conditional query
   */
  async updateMessageRAG(id: string, value: any, options?: QueryOptions) {
    await this.messageModel.updateMessageRAG(id, value);
    return this.queryWithSuccess(options);
  }

  /**
   * Update plugin error with optional message list return
   * Pattern: update + conditional query
   */
  async updatePluginError(id: string, value: any, options?: QueryOptions) {
    await this.messageModel.updateMessagePlugin(id, { error: value });
    return this.queryWithSuccess(options);
  }

  /**
   * Update plugin state and return message list
   * Pattern: update + conditional query
   */
  async updatePluginState(
    id: string,
    value: any,
    options: QueryOptions,
  ): Promise<{ messages?: UIChatMessage[]; success: boolean }> {
    await this.messageModel.updatePluginState(id, value);
    return this.queryWithSuccess(options);
  }

  /**
   * Update message plugin and return message list
   * Pattern: update + conditional query
   */
  async updateMessagePlugin(
    id: string,
    value: any,
    options: QueryOptions,
  ): Promise<{ messages?: UIChatMessage[]; success: boolean }> {
    await this.messageModel.updateMessagePlugin(id, value);
    return this.queryWithSuccess(options);
  }

  /**
   * Update message and return message list
   * Pattern: update + conditional query
   */
  async updateMessage(
    id: string,
    value: UpdateMessageParams,
    options: QueryOptions,
  ): Promise<{ messages?: UIChatMessage[]; success: boolean }> {
    const updateStartedAt = Date.now();
    const modelTiming = createModelTiming(options, 'lambda.message.update.dbUpdate');
    if (modelTiming) {
      await this.messageModel.update(id, value as any, modelTiming);
    } else {
      await this.messageModel.update(id, value as any);
    }
    logMessageTiming(options, 'lambda.message.update.dbUpdate:done', {
      stageMs: getDurationMs(updateStartedAt),
      valueKeys: Object.keys(value ?? {}),
    });

    return this.queryWithSuccess(options);
  }

  /**
   * Update message metadata with optional message list return
   * Pattern: update + conditional query
   */
  async updateMetadata(id: string, value: any, options?: QueryOptions) {
    await this.messageModel.updateMetadata(id, value);
    return this.queryWithSuccess(options);
  }

  /**
   * Update tool message with content, metadata, pluginState, and pluginError in a single transaction
   * This prevents race conditions when updating multiple fields
   * Pattern: update + conditional query
   */
  async updateToolMessage(
    id: string,
    value: {
      content?: string;
      heterogeneousToolState?: HeterogeneousToolStateSnapshot;
      metadata?: Record<string, any>;
      pluginError?: any;
      pluginState?: Record<string, any>;
    },
    options?: QueryOptions,
  ): Promise<{ messages?: UIChatMessage[]; success: boolean }> {
    const result = await this.messageModel.updateToolMessage(id, value);
    if (!result.success) {
      return { success: false };
    }
    return this.queryWithSuccess(options);
  }

  /**
   * Add files to a message
   * Pattern: update + conditional query
   */
  async addFilesToMessage(
    messageId: string,
    fileIds: string[],
    options?: QueryOptions,
  ): Promise<{ messages?: UIChatMessage[]; success: boolean }> {
    const result = await this.messageModel.addFiles(messageId, fileIds);
    if (!result.success) {
      return { success: false };
    }
    return this.queryWithSuccess(options);
  }

  /**
   * Update tool arguments by toolCallId - updates both tool message plugin.arguments
   * and parent assistant message tools[].arguments atomically
   *
   * This method uses toolCallId (the stable identifier from AI response) instead of
   * tool message ID, which allows updating arguments even when the tool message
   * hasn't been persisted yet (e.g., during intervention pending state).
   *
   * @param toolCallId - The tool call ID (stable identifier from AI response)
   * @param args - The new arguments value (will be stringified if object)
   * @param options - Query options for returning updated messages
   */
  async updateToolArguments(
    toolCallId: string,
    args: string | Record<string, unknown>,
    options?: QueryOptions,
  ): Promise<{ messages?: UIChatMessage[]; success: boolean }> {
    const argsString = typeof args === 'string' ? args : JSON.stringify(args);

    const result = await this.messageModel.updateToolArguments(toolCallId, argsString);
    if (!result.success) {
      return { success: false };
    }
    return this.queryWithSuccess(options);
  }

  // =============== Compression Methods ===============

  /**
   * Create a compression group for messages
   * Creates a placeholder group, marks messages as compressed, and returns updated messages
   *
   * @param topicId - The topic ID
   * @param messageIds - IDs of messages to compress
   * @param options - Query options for returning updated messages
   */
  async createCompressionGroup(
    topicId: string,
    messageIds: string[],
    options?: QueryOptions,
  ): Promise<{
    messageGroupId: string;
    messages?: UIChatMessage[];
    messagesToSummarize: UIChatMessage[];
    success: boolean;
  }> {
    // 1. Get messages that need to be summarized (before marking them as compressed)
    const allMessages = await this.messageModel.query(
      { topicId, ...options },
      this.getQueryOptions(),
    );

    const messagesToSummarize = allMessages.filter((msg) => messageIds.includes(msg.id));

    // 2. Create compression group with placeholder content
    const messageGroupId = await this.compressionRepository.createCompressionGroup({
      content: '...', // Placeholder content
      messageIds,
      metadata: {
        originalMessageCount: messageIds.length,
      },
      topicId,
    });

    // 3. Query updated messages (compressed messages will be grouped)
    const messages = await this.messageModel.query({ topicId, ...options }, this.getQueryOptions());

    return {
      messageGroupId,
      messages,
      messagesToSummarize,
      success: true,
    };
  }

  /**
   * Finalize compression by updating the group with actual summary content
   *
   * @param messageGroupId - The compression group ID
   * @param content - The generated summary content
   * @param params - Parameters for querying messages
   */
  async finalizeCompression(
    messageGroupId: string,
    content: string,
    params: {
      agentId: string;
      groupId?: string | null;
      sourceGroupIds?: string[];
      threadId?: string | null;
      topicId: string;
    },
  ): Promise<{ messages?: UIChatMessage[]; success: boolean }> {
    const { agentId, groupId, sourceGroupIds, threadId, topicId } = params;

    // 1. Update the new group and atomically replace prior compression groups.
    await this.compressionRepository.finalizeCompressionGroup({
      content,
      groupId: messageGroupId,
      sourceGroupIds,
      topicId,
    });

    // 2. Query final messages
    const queryOptions = { agentId, groupId, threadId, topicId };
    const finalMessages = await this.messageModel.query(queryOptions, this.getQueryOptions());

    return {
      messages: finalMessages,
      success: true,
    };
  }

  /**
   * Update message group metadata (e.g., expanded state)
   */
  async updateMessageGroupMetadata(
    messageGroupId: string,
    metadata: { expanded?: boolean },
    context: QueryOptions,
  ): Promise<{ messages: UIChatMessage[] }> {
    await this.compressionRepository.updateMetadata(messageGroupId, metadata);

    const messages = await this.messageModel.query(context, this.getQueryOptions());

    return { messages };
  }

  /**
   * Cancel compression by deleting the compression group and restoring original messages
   *
   * @param messageGroupId - The compression group ID to cancel
   * @param context - Query options for returning updated messages
   */
  async cancelCompression(
    messageGroupId: string,
    context: QueryOptions,
  ): Promise<{ messages: UIChatMessage[]; success: boolean }> {
    // Delete compression group (this also unmarks messages)
    await this.compressionRepository.deleteCompressionGroup(messageGroupId);

    // Query updated messages
    const messages = await this.messageModel.query(context, this.getQueryOptions());

    return { messages, success: true };
  }
}
