import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { TopicController } from '../controllers';
import { requireAuth } from '../middleware';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  TopicCreateRequestSchema,
  TopicDeleteParamSchema,
  TopicGetParamSchema,
  TopicListQuerySchema,
  TopicUpdateParamSchema,
  TopicUpdateRequestSchema,
} from '../types/topic.type';

// Topic 相关路由
const TopicsRoutes = new Hono();

// GET /api/v1/topics - 获取话题列表（支持分页和会话过滤）
TopicsRoutes.get(
  '/',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('TOPIC_READ'),
    'You do not have permission to read topics',
  ),
  zValidator('query', TopicListQuerySchema),
  (c) => {
    const controller = new TopicController();
    return controller.handleGetTopics(c);
  },
);

// POST /api/v1/topics - 创建新的话题
TopicsRoutes.post(
  '/',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('TOPIC_CREATE'),
    'You do not have permission to create topics',
  ),
  zValidator('json', TopicCreateRequestSchema),
  (c) => {
    const controller = new TopicController();
    return controller.handleCreateTopic(c);
  },
);

// GET /api/v1/topics/:id - 获取指定话题
TopicsRoutes.get(
  '/:id',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('TOPIC_READ'),
    'You do not have permission to read topics',
  ),
  zValidator('param', TopicGetParamSchema),
  (c) => {
    const controller = new TopicController();
    return controller.handleGetTopicById(c);
  },
);

// PATCH /api/v1/topics/:id - 更新话题
TopicsRoutes.patch(
  '/:id',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('TOPIC_UPDATE'),
    'You do not have permission to update topics',
  ),
  zValidator('param', TopicUpdateParamSchema),
  zValidator('json', TopicUpdateRequestSchema),
  (c) => {
    const controller = new TopicController();
    return controller.handleUpdateTopic(c);
  },
);

// DELETE /api/v1/topics/:id - 删除话题
TopicsRoutes.delete(
  '/:id',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('TOPIC_DELETE'),
    'You do not have permission to delete topics',
  ),
  zValidator('param', TopicDeleteParamSchema),
  (c) => {
    const controller = new TopicController();
    return controller.handleDeleteTopic(c);
  },
);

export default TopicsRoutes;
