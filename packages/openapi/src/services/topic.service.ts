import { and, count, desc, eq, ilike, isNull, notInArray } from 'drizzle-orm';

import { agentsToSessions, messages, topics, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { idGenerator } from '@/database/utils/idGenerator';

import { BaseService } from '../common/base.service';
import { processPaginationConditions } from '../helpers/pagination';
import type {
  TopicCreateRequest,
  TopicListQuery,
  TopicListResponse,
  TopicResponse,
  TopicUpdateRequest,
} from '../types/topic.type';

export class TopicService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null) {
    super(db, userId);
  }

  /**
   * 获取话题列表（支持按 agent/group 过滤）
   * @param request 查询参数
   * @returns 话题列表
   */
  async getTopics(request: TopicListQuery): Promise<TopicListResponse> {
    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('TOPIC_READ');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限访问话题列表');
      }

      // 构建查询条件
      const conditions = [];

      // 添加权限相关的查询条件
      if (permissionResult?.condition?.userId) {
        conditions.push(eq(topics.userId, permissionResult.condition.userId));
      }

      // 优先按 groupId 过滤
      if (request.groupId) {
        conditions.push(eq(topics.groupId, request.groupId));
      } else if (request.agentId) {
        // 通过 agentId 反查 sessionId，再按 sessionId 过滤
        const [relation] = await this.db
          .select({ sessionId: agentsToSessions.sessionId })
          .from(agentsToSessions)
          .where(eq(agentsToSessions.agentId, request.agentId))
          .limit(1);

        if (relation) {
          conditions.push(eq(topics.sessionId, relation.sessionId));
        } else {
          // agentId 不存在对应 session，直接返回空
          return { topics: [], total: 0 };
        }
      } else if (request.isInbox) {
        // inbox：sessionId 为 null 且 groupId 为 null 且 agentId 为 null
        conditions.push(isNull(topics.sessionId));
        conditions.push(isNull(topics.groupId));
        conditions.push(isNull(topics.agentId));
      }

      // 排除指定触发来源的话题
      if (request.excludeTriggers && request.excludeTriggers.length > 0) {
        conditions.push(notInArray(topics.trigger, request.excludeTriggers));
      }

      // 如果有关键词，添加标题的模糊搜索条件
      if (request.keyword) {
        conditions.push(ilike(topics.title, `%${request.keyword}%`));
      }

      // 统一查询路径与并发计数/列表
      const { limit, offset } = processPaginationConditions(request);
      const whereExpr = conditions.length ? and(...conditions) : undefined;

      // 构建列表查询基础
      const baseListQuery = this.db
        .select({
          messageCount: count(messages.id),
          topic: topics,
          user: users,
        })
        .from(topics)
        .leftJoin(messages, eq(topics.id, messages.topicId))
        .innerJoin(users, eq(topics.userId, users.id))
        .groupBy(topics.id, users.id)
        .orderBy(desc(topics.favorite), desc(topics.createdAt))
        .where(whereExpr);

      // 分页参数
      const listQuery = limit ? baseListQuery.limit(limit).offset(offset!) : baseListQuery;

      // 构建计数查询
      const countQuery = this.db.select({ count: count() }).from(topics).where(whereExpr);

      const [result, [countResult]] = await Promise.all([listQuery, countQuery]);

      return {
        topics: result.map((item) => ({
          ...item.topic,
          messageCount: item.messageCount,
          user: item.user,
        })),
        total: countResult.count,
      };
    } catch (error) {
      this.handleServiceError(error, '获取话题列表');
    }
  }

  async getTopicById(topicId: string): Promise<TopicResponse> {
    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('TOPIC_READ', {
        targetTopicId: topicId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限访问该话题');
      }

      // 构建查询条件
      const whereConditions = [eq(topics.id, topicId)];

      // 应用权限条件
      if (permissionResult.condition?.userId) {
        whereConditions.push(eq(topics.userId, permissionResult.condition.userId));
      }

      const [result] = await this.db
        .select({
          messageCount: count(messages.id),
          topic: topics,
          user: users,
        })
        .from(topics)
        .leftJoin(messages, eq(topics.id, messages.topicId))
        .innerJoin(users, eq(topics.userId, users.id))
        .where(and(...whereConditions))
        .groupBy(topics.id, users.id)
        .limit(1);

      if (!result) {
        throw this.createNotFoundError('话题不存在');
      }

      return {
        ...result.topic,
        messageCount: result.messageCount,
        user: result.user,
      };
    } catch (error) {
      return this.handleServiceError(error, '获取话题');
    }
  }

  /**
   * 创建新的话题
   * @param payload 创建参数
   * @returns 创建的话题信息
   */
  async createTopic(payload: TopicCreateRequest): Promise<TopicResponse> {
    try {
      const { agentId, groupId, title, favorite, clientId } = payload;

      // agentId 时反查 sessionId
      let effectiveSessionId: string | null = null;

      if (!effectiveSessionId && agentId) {
        const [relation] = await this.db
          .select({ sessionId: agentsToSessions.sessionId })
          .from(agentsToSessions)
          .where(eq(agentsToSessions.agentId, agentId))
          .limit(1);

        effectiveSessionId = relation?.sessionId ?? null;
      }

      const permissionResult = await this.resolveOperationPermission(
        'TOPIC_CREATE',
        effectiveSessionId ? { targetSessionId: effectiveSessionId } : undefined,
      );

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权创建话题');
      }

      const [newTopic] = await this.db
        .insert(topics)
        .values({
          agentId: agentId ?? null,
          clientId: clientId ?? null,
          favorite: favorite ?? false,
          groupId: groupId ?? null,
          id: idGenerator('topics'),
          sessionId: effectiveSessionId,
          title,
          userId: this.userId,
        })
        .returning();

      return this.getTopicById(newTopic.id);
    } catch (error) {
      this.handleServiceError(error, '创建话题');
    }
  }

  /**
   * 更新话题
   * @param topicId 话题ID
   * @param title 话题标题
   * @returns 更新后的话题信息
   */
  async updateTopic(topicId: string, payload: TopicUpdateRequest): Promise<Partial<TopicResponse>> {
    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('TOPIC_UPDATE', {
        targetTopicId: topicId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限更新该话题');
      }

      // 构建查询条件检查话题是否存在
      const whereConditions = [eq(topics.id, topicId)];

      // 应用权限条件
      if (permissionResult.condition?.userId) {
        whereConditions.push(eq(topics.userId, permissionResult.condition.userId));
      }

      const [updatedTopic] = await this.db
        .update(topics)
        .set(payload)
        .where(and(...whereConditions))
        .returning();

      if (!updatedTopic) {
        throw this.createNotFoundError('话题不存在');
      }

      return this.getTopicById(updatedTopic.id);
    } catch (error) {
      return this.handleServiceError(error, '更新话题');
    }
  }

  /**
   * 删除话题
   * @param topicId 话题ID
   */
  async deleteTopic(topicId: string): Promise<void> {
    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('TOPIC_DELETE', {
        targetTopicId: topicId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限删除该话题');
      }

      // 构建查询条件检查话题是否存在
      const whereConditions = [eq(topics.id, topicId)];

      // 应用权限条件
      if (permissionResult.condition?.userId) {
        whereConditions.push(eq(topics.userId, permissionResult.condition.userId));
      }

      const [existingTopic] = await this.db
        .delete(topics)
        .where(and(...whereConditions))
        .returning();

      if (!existingTopic) {
        throw this.createNotFoundError('话题不存在');
      }

      this.log('info', '话题删除成功', { topicId });
    } catch (error) {
      return this.handleServiceError(error, '删除话题');
    }
  }
}
