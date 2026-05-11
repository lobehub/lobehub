import { type LobeChatDatabase } from '@lobechat/database';
import { CompressionRepository } from '@lobechat/database';
import {
  type CreateMessageParams,
  type UIChatMessage,
  type UpdateMessageParams,
} from '@lobechat/types';

import { MessageModel } from '@/database/models/message';

import { FileService } from '../file';

interface QueryOptions {
  agentId?: string | null;
  groupId?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
}

interface CreateMessageResult {
  id: string;
  messages: any[];
}

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

  constructor(db: LobeChatDatabase, userId: string) {
    this.messageModel = new MessageModel(db, userId);
    this.fileService = new FileService(db, userId);
    this.compressionRepository = new CompressionRepository(db, userId);
  }

  /**
   * Unified URL processing function
   */
  private get postProcessUrl() {
    return (path: string | null) => this.fileService.getFullFileUrl(path);
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
      return { success: true };
    }

    const { agentId, sessionId, topicId, groupId, threadId } = options;

    const messages = await this.messageModel.query(
      { agentId, groupId, sessionId, threadId, topicId },
      this.getQueryOptions(),
    );

    return { messages, success: true };
  }

  /**
   * Create a new message and return the complete message list
   * Pattern: create + query
   *
   * This method combines message creation and querying into a single operation,
   * reducing the need for separate refresh calls and improving performance.
   */
  async createMessage(params: CreateMessageParams): Promise<CreateMessageResult> {
    // 1. Create the message (using agentId)
    const item = await this.messageModel.create(params);

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
    await this.messageModel.update(id, value as any);
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
    // 1. Get messages that need to be summarized (before marking them as compressed).
    // Query by ID directly instead of going through messageModel.query — that path applies
    // a scope filter (agentId / groupId / threadId) and additionally drops any message
    // whose messageGroupId is non-null. Both of those interact badly with /compact:
    //   - Group-chat /compact called from useAgentContext sends groupId=undefined while
    //     the actual messages have groupId='cg_...', so scope filtering returns 0 rows.
    //   - Re-compressing a topic that already has one compression group would also lose
    //     every messageId because of the isNull(messageGroupId) clause.
    // Client passed an explicit messageIds list — look those up by ID, then confine the
    // result to the active topic so a malformed/crafted request cannot drag in messages
    // from other topics (queryByIds scopes by userId only).
    const { postProcessUrl } = this.getQueryOptions();
    const rawMessages = await this.messageModel.queryByIds(messageIds, { postProcessUrl });
    const messagesToSummarize = rawMessages.filter((msg) => msg.topicId === topicId);
    const scopedMessageIds = messagesToSummarize.map((msg) => msg.id);

    if (scopedMessageIds.length === 0) {
      throw new Error(
        '[createCompressionGroup] No messages found for the provided messageIds within the ' +
          'requested topic. The ids may have been deleted, never persisted, belong to a ' +
          'different user, or reference another topic.',
      );
    }

    // 2. Create compression group with placeholder content
    const messageGroupId = await this.compressionRepository.createCompressionGroup({
      content: '...', // Placeholder content
      messageIds: scopedMessageIds,
      metadata: {
        originalMessageCount: scopedMessageIds.length,
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
      threadId?: string | null;
      topicId: string;
    },
  ): Promise<{ messages?: UIChatMessage[]; success: boolean }> {
    const { agentId, groupId, threadId, topicId } = params;

    // 1. Update compression group with actual content
    await this.compressionRepository.updateCompressionContent(messageGroupId, content);

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
