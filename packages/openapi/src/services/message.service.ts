import { and, asc, count, desc, eq, ilike, inArray, isNull } from 'drizzle-orm';

import { messages, messagesFiles } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { idGenerator } from '@/database/utils/idGenerator';
import { FileService as CoreFileService } from '@/server/services/file';

import { BaseService } from '../common/base.service';
import { processPaginationConditions } from '../helpers/pagination';
import type { ServiceResult } from '../types';
import type {
  MessageListResponse,
  MessageResponse,
  MessageResponseFromDatabase,
  MessagesCountQuery,
  MessagesCreateRequest,
  MessagesListQuery,
  SearchMessagesByKeywordRequest,
} from '../types/message.type';
import { ChatService } from './chat.service';

/**
 * Message count result type
 */
export interface MessageCountResult {
  count: number;
}

/**
 * Message service implementation class (Hono API specific)
 * Provides various message count statistics functions
 */
export class MessageService extends BaseService {
  private coreFileService: CoreFileService;

  constructor(db: LobeChatDatabase, userId: string | null) {
    super(db, userId);

    this.coreFileService = new CoreFileService(db, userId!);
  }

  /**
   * Format message content, currently mainly formatting the file list
   * @param fileId File ID
   * @returns
   */
  private async formatMessages(
    messages?: MessageResponseFromDatabase[],
  ): Promise<MessageResponse[]> {
    if (!messages?.length) {
      return [] as MessageResponse[];
    }

    return await Promise.all(
      messages.map(async (message) => {
        const messageWithoutFiles = { ...message };
        delete (messageWithoutFiles as any).filesToMessages;

        return {
          ...messageWithoutFiles,
          files: await Promise.all(
            message.filesToMessages?.map(async ({ file }) => {
              if (file.url.startsWith('http')) {
                return file;
              }

              return {
                ...file,
                url: await this.coreFileService.getFullFileUrl(file.url),
              };
            }) ?? [],
          ),
        };
      }),
    );
  }

  /**
   * Count total messages by user ID
   * @param targetUserId Target user ID
   * @returns Message count result
   */
  async countMessagesByUserId(targetUserId: string): ServiceResult<MessageCountResult> {
    this.log('info', '根据用户ID统计消息数量', { targetUserId });

    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('MESSAGE_READ', {
        targetUserId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此用户的消息');
      }

      const result = await this.db
        .select({ count: count() })
        .from(messages)
        .where(eq(messages.userId, targetUserId));

      const messageCount = result[0]?.count || 0;
      this.log('info', '用户消息统计完成', { count: messageCount });

      return { count: messageCount };
    } catch (error) {
      this.handleServiceError(error, '根据用户ID统计消息数量');
    }
  }

  /**
   * Count total messages by topic ID array
   * @param topicIds Topic ID array
   * @returns Message count result
   */
  async countMessagesByTopicIds(topicIds: string[]): ServiceResult<MessageCountResult> {
    this.log('info', '根据话题ID数组统计消息数量', { topicIds, userId: this.userId });

    try {
      // Permission check
      const permissionResult = await this.resolveBatchQueryPermission('MESSAGE_READ', {
        targetTopicIds: topicIds,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此话题的消息');
      }

      const result = await this.db
        .select({ count: count() })
        .from(messages)
        .where(inArray(messages.topicId, topicIds));

      const messageCount = result[0]?.count || 0;
      this.log('info', '话题消息统计完成', { count: messageCount });

      return { count: messageCount };
    } catch (error) {
      this.handleServiceError(error, '根据话题ID数组统计消息数量');
    }
  }

  /**
   * Unified message count method
   * @param query Query parameters
   * @returns Message count result
   */
  async countMessages(query: MessagesCountQuery): ServiceResult<MessageCountResult> {
    this.log('info', '统计消息数量', { query, userId: this.userId });

    try {
      // Count by user ID (requires special permission check)
      if (query.userId) {
        return await this.countMessagesByUserId(query.userId);
      }

      // Count by topic ID array
      if (query.topicIds && query.topicIds.length > 0) {
        return await this.countMessagesByTopicIds(query.topicIds);
      }

      // Count all messages for the current user
      const result = await this.db
        .select({ count: count() })
        .from(messages)
        .where(eq(messages.userId, this.userId!));

      const messageCount = result[0]?.count || 0;
      this.log('info', '当前用户消息统计完成', { count: messageCount });

      return { count: messageCount };
    } catch (error) {
      this.handleServiceError(error, '统计消息数量');
    }
  }

  /**
   * Fuzzy search messages and corresponding topics by keyword
   * @param searchRequest Search request parameters
   * @returns Result list containing message and topic information
   */
  async searchMessagesByKeyword(
    searchRequest: SearchMessagesByKeywordRequest,
  ): ServiceResult<MessageResponse[]> {
    this.log('info', '根据关键词搜索消息', {
      ...searchRequest,
      userId: this.userId,
    });

    try {
      // Permission check: verify session ownership and whether the user has message read permission
      const permissionResult = await this.resolveOperationPermission('MESSAGE_READ');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权搜索消息');
      }

      const { keyword, limit = 20, offset = 0 } = searchRequest;

      // Build query conditions
      const conditions = [eq(messages.userId, this.userId!)];

      const contentMatchedMessages = await this.db
        .select({ id: messages.id })
        .from(messages)
        .where(and(ilike(messages.content, `%${keyword}%`), ...conditions));

      if (contentMatchedMessages.length === 0) {
        this.log('info', '关键词搜索消息完成', { keyword, resultCount: 0 });
        return [];
      }

      // Use relational query with 'with' to get complete message information
      const result = (await this.db.query.messages.findMany({
        limit,
        offset,
        orderBy: desc(messages.createdAt),
        where: inArray(
          messages.id,
          contentMatchedMessages.map((msg) => msg.id),
        ),
        with: {
          filesToMessages: {
            with: {
              file: true,
            },
          },
          session: true,
          topic: true,
          translation: true,
        },
      })) as MessageResponseFromDatabase[];

      this.log('info', '关键词搜索消息完成', {
        keyword,
        resultCount: result.length,
      });

      return this.formatMessages(result);
    } catch (error) {
      this.handleServiceError(error, '关键词搜索消息');
    }
  }

  /**
   * Unified message list query method
   * @param request Query parameters
   * @returns Message list
   */
  async getMessages(request: MessagesListQuery): ServiceResult<MessageListResponse> {
    this.log('info', '获取消息列表', { request, userId: this.userId });

    try {
      if (!request.userId && !request.topicId) {
        throw this.createValidationError('获取消息列表时必须提供 userId 或 topicId');
      }

      // Build query conditions
      const conditions = [];

      // Verify user ownership and whether the user has message read permission
      if (request.userId) {
        const permissionResult = await this.resolveOperationPermission('MESSAGE_READ', {
          targetUserId: request.userId,
        });

        if (!permissionResult.isPermitted) {
          throw this.createAuthorizationError(permissionResult.message || '无权访问消息列表');
        }

        conditions.push(eq(messages.userId, request.userId));
      }

      // Verify topic ownership and whether the user has message read permission
      if (request.topicId) {
        const permissionResult = await this.resolveOperationPermission('MESSAGE_READ', {
          targetTopicId: request.topicId,
        });

        if (!permissionResult.isPermitted) {
          throw this.createAuthorizationError(permissionResult.message || '无权访问消息列表');
        }

        conditions.push(eq(messages.topicId, request.topicId));
      }

      if (request.role) {
        conditions.push(eq(messages.role, request.role));
      }

      if (request.keyword) {
        conditions.push(ilike(messages.content, `%${request.keyword}%`));
      }

      // Calculate offset

      const { limit, offset } = processPaginationConditions(request);
      const whereExpr = conditions.length ? and(...conditions) : undefined;

      // Build query statement
      const listQuery = this.db.query.messages.findMany({
        limit,
        offset,
        orderBy: asc(messages.createdAt),
        where: whereExpr,
        with: {
          filesToMessages: {
            with: {
              file: true,
            },
          },
          session: true,
          topic: true,
          translation: true,
        },
      });

      const countQuery = this.db.select({ count: count() }).from(messages).where(whereExpr);

      const [messageList, countResult] = await Promise.all([listQuery, countQuery]);

      const messageListWithFiles = await this.formatMessages(
        messageList as MessageResponseFromDatabase[],
      );

      this.log('info', '获取消息列表完成', { count: messageListWithFiles.length });

      return {
        messages: messageListWithFiles,
        total: countResult[0]?.count || 0,
      };
    } catch (error) {
      this.handleServiceError(error, '获取消息列表');
    }
  }

  /**
   * Get message details by message ID
   * @param messageId Message ID
   * @returns Message details
   */
  async getMessageById(messageId: string): ServiceResult<MessageResponse | null> {
    this.log('info', '根据消息ID获取消息详情', { messageId, userId: this.userId });

    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('MESSAGE_READ', {
        targetMessageId: messageId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此消息');
      }

      // Build query conditions
      const conditions = [eq(messages.id, messageId)];
      if (permissionResult.condition?.userId) {
        conditions.push(eq(messages.userId, permissionResult.condition.userId));
      }

      const message = (await this.db.query.messages.findFirst({
        where: and(...conditions),
        with: {
          filesToMessages: {
            with: {
              file: true,
            },
          },
          session: true,
          topic: true,
          translation: true,
        },
      })) as MessageResponseFromDatabase;

      if (!message) {
        this.log('info', '消息不存在或无权限访问', { messageId });
        return null;
      }

      this.log('info', '获取消息详情完成', { messageId });

      const messageWithFiles = await this.formatMessages([message]);

      return messageWithFiles[0];
    } catch (error) {
      this.handleServiceError(error, '获取消息详情');
    }
  }

  /**
   * Create a new message
   * @param messageData Message data
   * @returns Created message (includes session and user information)
   */
  async createMessage(messageData: MessagesCreateRequest): ServiceResult<MessageResponse> {
    this.log('info', '创建新消息', {
      role: messageData.role,
      topicId: messageData.topicId,
      userId: this.userId,
    });

    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission(
        'MESSAGE_CREATE',
        messageData.topicId ? { targetTopicId: messageData.topicId } : undefined,
      );

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权创建消息');
      }

      const [newMessage] = await this.db
        .insert(messages)
        .values({
          agentId: messageData.agentId,
          clientId: messageData.clientId,
          content: messageData.content,
          favorite: messageData.favorite ?? false,
          id: idGenerator('messages'),
          metadata: messageData.metadata,
          model: messageData.model,
          observationId: messageData.observationId,
          parentId: messageData.parentId,
          provider: messageData.provider,
          quotaId: messageData.quotaId,
          reasoning: messageData.reasoning,
          role: messageData.role,
          search: messageData.search,
          sessionId: null,
          threadId: messageData.threadId,
          tools: messageData.tools,
          topicId: messageData.topicId,
          traceId: messageData.traceId,
          userId: this.userId!,
        })
        .returning({
          id: messages.id,
        });

      // Handle file attachments
      if (messageData.files && messageData.files.length > 0) {
        this.log('info', '消息包含文件附件', {
          files: messageData.files,
          messageId: newMessage.id,
        });

        // Update the messages_files table
        await this.db.insert(messagesFiles).values(
          messageData.files.map((fileId) => ({
            fileId,
            messageId: newMessage.id,
            userId: this.userId!,
          })),
        );
      }

      // Re-query the complete message including session and topic information
      const completeMessage = (await this.db.query.messages.findFirst({
        where: eq(messages.id, newMessage.id),
        with: {
          filesToMessages: {
            with: {
              file: true,
            },
          },
          session: true,
          topic: true,
          translation: true,
        },
      })) as MessageResponseFromDatabase;

      if (!completeMessage) {
        throw new Error('无法查询到刚创建的消息');
      }

      this.log('info', '创建消息完成', { messageId: newMessage.id });

      const completeMessageWithFiles = await this.formatMessages([completeMessage]);

      return completeMessageWithFiles[0];
    } catch (error) {
      this.handleServiceError(error, '创建消息');
    }
  }

  /**
   * Create a user message and generate an AI reply
   * @param messageData User message data
   * @returns User message ID and AI reply message ID
   */
  async createMessageWithAIReply(
    messageData: MessagesCreateRequest,
  ): ServiceResult<MessageResponse | null | undefined> {
    this.log('info', '创建消息并生成AI回复', {
      role: messageData.role,
      topicId: messageData.topicId,
      userId: this.userId,
    });

    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission(
        'MESSAGE_CREATE',
        messageData.topicId ? { targetTopicId: messageData.topicId } : undefined,
      );
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权创建消息');
      }

      // 1. Create user message
      const userMessage = await this.createMessage(messageData);

      // 2. If it is a user message, generate an AI reply
      if (messageData.role === 'user') {
        this.log('info', '开始获取对话历史');
        // Get conversation history
        const conversationHistory = await this.getConversationHistory(messageData.topicId);
        this.log('info', '对话历史获取完成', { historyLength: conversationHistory.length });

        // Use ChatService to generate reply
        this.log('info', '开始生成AI回复', {
          model: messageData.model,
          provider: messageData.provider,
          userId: this.userId,
        });

        const chatService = new ChatService(this.db, this.userId);
        let aiReplyContent = '';

        try {
          aiReplyContent = await chatService.generateReply({
            conversationHistory,
            model: messageData.model,
            provider: messageData.provider,
            sessionId: null,
            userMessage: messageData.content,
          });
          this.log('info', 'AI回复生成完成', { replyLength: aiReplyContent.length });
        } catch (replyError) {
          this.log('error', 'AI回复生成失败，使用默认回复', {
            error: replyError instanceof Error ? replyError.message : String(replyError),
          });
          aiReplyContent = '抱歉，AI 服务暂时不可用，请稍后再试。';
        }

        // 3. Create AI reply message
        const aiReplyData: MessagesCreateRequest = {
          content: aiReplyContent,
          model: messageData.model,
          provider: messageData.provider,
          role: 'assistant',
          topicId: messageData.topicId,
        };

        this.log('info', '开始创建AI回复消息');
        const aiReply = await this.createMessage(aiReplyData);
        this.log('info', 'AI回复消息创建完成', { aiReplyId: aiReply.id });

        this.log('info', '创建消息和AI回复完成', {
          aiReplyId: aiReply.id,
          userMessageId: userMessage.id,
        });

        return this.getMessageById(aiReply.id);
      }

      // If it is not a user message, return empty
      return;
    } catch (error) {
      this.handleServiceError(error, '创建消息并生成AI回复');
    }
  }

  /**
   * Get conversation history
   * @param topicId Topic ID
   * @param limit Message count limit
   * @returns Conversation history
   */
  private async getConversationHistory(
    topicId: string | null,
    limit: number = 10,
  ): Promise<Array<{ content: string; role: 'user' | 'assistant' | 'system' }>> {
    try {
      const result = await this.db.query.messages.findMany({
        columns: {
          content: true,
          role: true,
        },
        limit,
        orderBy: desc(messages.createdAt),
        where: and(
          topicId === null ? isNull(messages.topicId) : eq(messages.topicId, topicId),
          eq(messages.userId, this.userId!),
        ),
      });

      // Reverse order so the latest messages are at the end
      return result
        .reverse()
        .filter((msg) => msg.content && ['user', 'assistant'].includes(msg.role))
        .map((msg) => ({
          content: msg.content!,
          role: msg.role as 'user' | 'assistant',
        }));
    } catch (error) {
      this.log('error', '获取对话历史失败', {
        error: error instanceof Error ? error.message : String(error),
        topicId,
      });
      return [];
    }
  }

  /**
   * Delete a single message
   * @param messageId Message ID
   * @returns Promise<void>
   */
  async deleteMessage(messageId: string): Promise<void> {
    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('MESSAGE_DELETE', {
        targetMessageId: messageId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限删除该消息');
      }

      // Build delete conditions
      const whereConditions = [eq(messages.id, messageId)];

      // Apply permission conditions
      if (permissionResult.condition?.userId) {
        whereConditions.push(eq(messages.userId, permissionResult.condition.userId));
      }

      // Use a transaction to delete messages and their associations with files
      await this.db.transaction(async (trx) => {
        await trx.delete(messages).where(and(...whereConditions));
        await trx.delete(messagesFiles).where(eq(messagesFiles.messageId, messageId));
      });

      this.log('info', '消息删除成功', { messageId });
    } catch (error) {
      return this.handleServiceError(error, '删除消息');
    }
  }

  /**
   * Delete messages in batch
   * @param messageIds Message ID array
   * @returns Promise<{ success: number; failed: number; errors: any[] }>
   */
  async deleteBatchMessages(messageIds: string[]): Promise<{
    errors: Array<{ error: string; messageId: string }>;
    failed: number;
    success: number;
  }> {
    try {
      const result = {
        errors: [] as Array<{ error: string; messageId: string }>,
        failed: 0,
        success: 0,
      };

      for (const messageId of messageIds) {
        try {
          await this.deleteMessage(messageId);
          result.success++;
        } catch (error) {
          result.failed++;
          result.errors.push({
            error: error instanceof Error ? error.message : String(error),
            messageId,
          });
        }
      }

      this.log('info', '批量删除消息完成', {
        failed: result.failed,
        success: result.success,
        total: messageIds.length,
      });

      return result;
    } catch (error) {
      return this.handleServiceError(error, '批量删除消息');
    }
  }
}
