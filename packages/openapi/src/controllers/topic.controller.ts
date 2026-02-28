import { Context } from 'hono';

import { BaseController } from '../common/base.controller';
import { TopicService } from '../services/topic.service';
import { TopicCreateRequest, TopicListQuery, TopicUpdateRequest } from '../types/topic.type';

export class TopicController extends BaseController {
  /**
   * 统一获取话题列表 (支持会话过滤)
   * GET /api/v1/topics?sessionId=xxx&keyword=xxx
   * Query: { sessionId?: string, keyword?: string }
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
   * 获取指定话题
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
   * 创建新的话题
   * POST /api/v1/topics
   * Body: { sessionId?: string, agentId?: string, groupId?: string, title: string, favorite?: boolean, clientId?: string }
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
   * 更新话题
   * PATCH /api/v1/topics/:id
   * Body: { title?: string, favorite?: boolean, historySummary?: string, metadata?: object, sessionId?: string }
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
   * 删除话题
   * DELETE /api/v1/topics/:id
   * Params: { id: string }
   */
  async handleDeleteTopic(c: Context) {
    try {
      const userId = this.getUserId(c)!;
      const topicId = c.req.param('id');

      const db = await this.getDatabase();
      const topicService = new TopicService(db, userId);
      await topicService.deleteTopic(topicId);

      return this.success(c, null, '删除话题成功');
    } catch (error) {
      return this.handleError(c, error);
    }
  }
}
