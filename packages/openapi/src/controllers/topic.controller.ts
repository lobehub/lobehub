import type { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { TopicService } from '../services/topic.service';
import type { TopicCreateRequest, TopicListQuery, TopicUpdateRequest } from '../types/topic.type';

export class TopicController extends BaseController {
  /**
   * Retrieves the topic list
   * GET /api/v1/topics?keyword=xxx
   * Query: { keyword?: string, agentId?: string, groupId?: string, isInbox?: boolean }
   */
  async handleGetTopics(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const request = this.getQuery<TopicListQuery>(c);

      const db = await this.getDatabase();
      const topicService = new TopicService(db, userId);

      const topics = await topicService.getTopics(request);

      return this.success(c, topics, '获取话题列表成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Retrieves a specific topic
   * GET /api/v1/topics/:id
   * Params: { id: string }
   */
  async handleGetTopicById(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { id } = this.getParams<{ id: string }>(c);

      const db = await this.getDatabase();
      const topicService = new TopicService(db, userId);
      const topic = await topicService.getTopicById(id);

      return this.success(c, topic, '获取话题成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Creates a new topic
   * POST /api/v1/topics
   * Body: { agentId?: string, groupId?: string, title: string, favorite?: boolean, clientId?: string }
   */
  async handleCreateTopic(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const payload = await this.getBody<TopicCreateRequest>(c);

      const db = await this.getDatabase();
      const topicService = new TopicService(db, userId);
      const newTopic = await topicService.createTopic(payload);

      return this.success(c, newTopic, '创建话题成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Updates a topic
   * PATCH /api/v1/topics/:id
   * Body: { title?: string, favorite?: boolean, historySummary?: string, metadata?: object }
   */
  async handleUpdateTopic(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { id } = this.getParams<{ id: string }>(c);
      const payload = await this.getBody<TopicUpdateRequest>(c);

      const db = await this.getDatabase();
      const topicService = new TopicService(db, userId);
      const updatedTopic = await topicService.updateTopic(id, payload);

      return this.success(c, updatedTopic, '更新话题成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }

  /**
   * Deletes a topic
   * DELETE /api/v1/topics/:id
   * Params: { id: string }
   */
  async handleDeleteTopic(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const { id: topicId } = this.getParams<{ id: string }>(c);

      const db = await this.getDatabase();
      const topicService = new TopicService(db, userId);
      await topicService.deleteTopic(topicId);

      return this.success(c, null, '删除话题成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
