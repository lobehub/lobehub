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
 * 消息统计结果类型
 */
export interface MessageCountResult {
  count: number;
}

/**
 * 消息服务实现类 (Hono API 专用)
 * 提供各种消息数量统计功能
 */
export class MessageService extends BaseService {
  private coreFileService: CoreFileService;

  constructor(db: LobeChatDatabase, userId: string | null) {
    super(db, userId);

    this.coreFileService = new CoreFileService(db, userId!);
  }

  /**
   * 对消息内容进行格式化，目前主要是对文件列表进行格式化
   * @param fileId 文件ID
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
   * 根据用户ID统计消息总数
   * @param targetUserId 目标用户ID
   * @returns 消息数量统计结果
   */
  async countMessagesByUserId(targetUserId: string): ServiceResult<MessageCountResult> {
    this.log('info', '根据用户ID统计消息数量', { targetUserId });

    try {
      // 权限校验
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
   * 根据话题ID数组统计消息总数
   * @param topicIds 话题ID数组
   * @returns 消息数量统计结果
   */
  async countMessagesByTopicIds(topicIds: string[]): ServiceResult<MessageCountResult> {
    this.log('info', '根据话题ID数组统计消息数量', { topicIds, userId: this.userId });

    try {
      // 权限校验
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
   * 统一的消息数量统计方法
   * @param query 查询参数
   * @returns 消息数量统计结果
   */
  async countMessages(query: MessagesCountQuery): ServiceResult<MessageCountResult> {
    this.log('info', '统计消息数量', { query, userId: this.userId });

    try {
      // 按用户ID统计 (需要特殊权限检查)
      if (query.userId) {
        return await this.countMessagesByUserId(query.userId);
      }

      // 按话题ID数组统计
      if (query.topicIds && query.topicIds.length > 0) {
        return await this.countMessagesByTopicIds(query.topicIds);
      }

      // 统计当前用户的所有消息
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
   * 根据关键词模糊搜索消息及对应话题
   * @param searchRequest 搜索请求参数
   * @returns 包含消息和话题信息的结果列表
   */
  async searchMessagesByKeyword(
    searchRequest: SearchMessagesByKeywordRequest,
  ): ServiceResult<MessageResponse[]> {
    this.log('info', '根据关键词搜索消息', {
      ...searchRequest,
      userId: this.userId,
    });

    try {
      // 权限校验，判断session的归属以及用户有没有消息的读取权限
      const permissionResult = await this.resolveOperationPermission('MESSAGE_READ');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权搜索消息');
      }

      const { keyword, limit = 20, offset = 0 } = searchRequest;

      // 构建查询条件
      const conditions = [eq(messages.userId, this.userId!)];

      const contentMatchedMessages = await this.db
        .select({ id: messages.id })
        .from(messages)
        .where(and(ilike(messages.content, `%${keyword}%`), ...conditions));

      if (contentMatchedMessages.length === 0) {
        this.log('info', '关键词搜索消息完成', { keyword, resultCount: 0 });
        return [];
      }

      // 使用 with 关联查询获取完整的消息信息
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
   * 统一的消息列表查询方法
   * @param request 查询参数
   * @returns 消息列表
   */
  async getMessages(request: MessagesListQuery): ServiceResult<MessageListResponse> {
    this.log('info', '获取消息列表', { request, userId: this.userId });

    try {
      if (!request.userId && !request.topicId) {
        throw this.createValidationError('获取消息列表时必须提供 userId 或 topicId');
      }

      // 构建查询条件
      const conditions = [];

      // 校验 user 的归属以及用户有没有消息的读取权限
      if (request.userId) {
        const permissionResult = await this.resolveOperationPermission('MESSAGE_READ', {
          targetUserId: request.userId,
        });

        if (!permissionResult.isPermitted) {
          throw this.createAuthorizationError(permissionResult.message || '无权访问消息列表');
        }

        conditions.push(eq(messages.userId, request.userId));
      }

      // 校验 topic 的归属以及用户有没有消息的读取权限
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

      // 计算偏移量

      const { limit, offset } = processPaginationConditions(request);
      const whereExpr = conditions.length ? and(...conditions) : undefined;

      // 创建查询语句
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
   * 根据消息ID获取消息详情
   * @param messageId 消息ID
   * @returns 消息详情
   */
  async getMessageById(messageId: string): ServiceResult<MessageResponse | null> {
    this.log('info', '根据消息ID获取消息详情', { messageId, userId: this.userId });

    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('MESSAGE_READ', {
        targetMessageId: messageId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此消息');
      }

      // 构建查询条件
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
   * 创建新消息
   * @param messageData 消息数据
   * @returns 创建的消息（包含 session 和 user 信息）
   */
  async createMessage(messageData: MessagesCreateRequest): ServiceResult<MessageResponse> {
    this.log('info', '创建新消息', {
      role: messageData.role,
      topicId: messageData.topicId,
      userId: this.userId,
    });

    try {
      // 权限校验
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

      // 处理文件附件
      if (messageData.files && messageData.files.length > 0) {
        this.log('info', '消息包含文件附件', {
          files: messageData.files,
          messageId: newMessage.id,
        });

        // 更新 messages_files 表
        await this.db.insert(messagesFiles).values(
          messageData.files.map((fileId) => ({
            fileId,
            messageId: newMessage.id,
            userId: this.userId!,
          })),
        );
      }

      // 重新查询包含 session 和 topic 信息的完整消息
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
   * 创建用户消息并生成AI回复
   * @param messageData 用户消息数据
   * @returns 用户消息ID和AI回复消息ID
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
      // 权限校验
      const permissionResult = await this.resolveOperationPermission(
        'MESSAGE_CREATE',
        messageData.topicId ? { targetTopicId: messageData.topicId } : undefined,
      );
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权创建消息');
      }

      // 1. 创建用户消息
      const userMessage = await this.createMessage(messageData);

      // 2. 如果是用户消息，生成AI回复
      if (messageData.role === 'user') {
        this.log('info', '开始获取对话历史');
        // 获取对话历史
        const conversationHistory = await this.getConversationHistory(messageData.topicId);
        this.log('info', '对话历史获取完成', { historyLength: conversationHistory.length });

        // 使用ChatService生成回复
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

        // 3. 创建AI回复消息
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

      // 如果不是用户消息，返回空
      return;
    } catch (error) {
      this.handleServiceError(error, '创建消息并生成AI回复');
    }
  }

  /**
   * 获取对话历史
   * @param topicId 话题ID
   * @param limit 消息数量限制
   * @returns 对话历史
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

      // 反转顺序，使最新的消息在后面
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
   * 删除单个消息
   * @param messageId 消息ID
   * @returns Promise<void>
   */
  async deleteMessage(messageId: string): Promise<void> {
    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('MESSAGE_DELETE', {
        targetMessageId: messageId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限删除该消息');
      }

      // 构建删除条件
      const whereConditions = [eq(messages.id, messageId)];

      // 应用权限条件
      if (permissionResult.condition?.userId) {
        whereConditions.push(eq(messages.userId, permissionResult.condition.userId));
      }

      // 使用事务删除消息、消息与文件的关联关系
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
   * 批量删除消息
   * @param messageIds 消息ID数组
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
