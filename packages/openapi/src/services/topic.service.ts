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
   * Get topic list (supports filtering by agent/group)
   * @param request Query parameters
   * @returns Topic list
   */
  async getTopics(request: TopicListQuery): Promise<TopicListResponse> {
    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('TOPIC_READ');

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限访问话题列表');
      }

      // Build query conditions
      const conditions = [];

      // Add permission-related query conditions
      if (permissionResult?.condition?.userId) {
        conditions.push(eq(topics.userId, permissionResult.condition.userId));
      }

      // Filter by groupId first
      if (request.groupId) {
        conditions.push(eq(topics.groupId, request.groupId));
      } else if (request.agentId) {
        // Reverse-lookup sessionId from agentId, then filter by sessionId
        const [relation] = await this.db
          .select({ sessionId: agentsToSessions.sessionId })
          .from(agentsToSessions)
          .where(eq(agentsToSessions.agentId, request.agentId))
          .limit(1);

        if (relation) {
          conditions.push(eq(topics.sessionId, relation.sessionId));
        } else {
          // No session found for agentId, return empty directly
          return { topics: [], total: 0 };
        }
      } else if (request.isInbox) {
        // inbox: sessionId is null, groupId is null, and agentId is null
        conditions.push(isNull(topics.sessionId));
        conditions.push(isNull(topics.groupId));
        conditions.push(isNull(topics.agentId));
      }

      // Exclude topics with specified trigger sources
      if (request.excludeTriggers && request.excludeTriggers.length > 0) {
        conditions.push(notInArray(topics.trigger, request.excludeTriggers));
      }

      // If keyword is provided, add fuzzy search condition on title
      if (request.keyword) {
        conditions.push(ilike(topics.title, `%${request.keyword}%`));
      }

      // Unified query path with concurrent count/list
      const { limit, offset } = processPaginationConditions(request);
      const whereExpr = conditions.length ? and(...conditions) : undefined;

      // Build base list query
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

      // Pagination parameters
      const listQuery = limit ? baseListQuery.limit(limit).offset(offset!) : baseListQuery;

      // Build count query
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
      // Permission check
      const permissionResult = await this.resolveOperationPermission('TOPIC_READ', {
        targetTopicId: topicId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限访问该话题');
      }

      // Build query conditions
      const whereConditions = [eq(topics.id, topicId)];

      // Apply permission conditions
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
   * Create a new topic
   * @param payload Create parameters
   * @returns Created topic info
   */
  async createTopic(payload: TopicCreateRequest): Promise<TopicResponse> {
    try {
      const { agentId, groupId, title, favorite, clientId } = payload;

      // When agentId is provided, reverse-lookup sessionId
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
   * Update topic
   * @param topicId Topic ID
   * @param title Topic title
   * @returns Updated topic info
   */
  async updateTopic(topicId: string, payload: TopicUpdateRequest): Promise<Partial<TopicResponse>> {
    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('TOPIC_UPDATE', {
        targetTopicId: topicId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限更新该话题');
      }

      // Build query conditions to check if topic exists
      const whereConditions = [eq(topics.id, topicId)];

      // Apply permission conditions
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
   * Delete topic
   * @param topicId Topic ID
   */
  async deleteTopic(topicId: string): Promise<void> {
    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('TOPIC_DELETE', {
        targetTopicId: topicId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '没有权限删除该话题');
      }

      // Build query conditions to check if topic exists
      const whereConditions = [eq(topics.id, topicId)];

      // Apply permission conditions
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

      this.log('info', 'Topic deleted successfully', { topicId });
    } catch (error) {
      return this.handleServiceError(error, '删除话题');
    }
  }
}
