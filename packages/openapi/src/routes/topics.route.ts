import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { TopicController } from '../controllers';
import { EvalContextController } from '../controllers/eval-context.controller';
import { requireAuth } from '../middleware';
import { requireAnyPermission } from '../middleware/permission-check';
import { EvalPaginationSchema } from '../types/eval-resource.type';
import {
  TopicCreateRequestSchema,
  TopicDeleteParamSchema,
  TopicGetParamSchema,
  TopicListQuerySchema,
  TopicUpdateParamSchema,
  TopicUpdateRequestSchema,
} from '../types/topic.type';

// Topic-related routes
const TopicsRoutes = new Hono();

// GET /api/v1/topics - Get topic list (supports pagination and agent/group filtering)
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

// POST /api/v1/topics - Create a new topic
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

// GET /api/v1/topics/:id - Get topic by ID
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

// PATCH /api/v1/topics/:id - Update topic
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

// DELETE /api/v1/topics/:id - Delete topic
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

TopicsRoutes.get(
  '/:topicId/threads',
  describeRoute({ summary: 'List topic threads', tags: ['topics'] }),
  requireAuth,
  requireAnyPermission(getAllScopePermissions('MESSAGE_READ')),
  zValidator('param', z.object({ topicId: z.string().min(1) })),
  zValidator('query', EvalPaginationSchema),
  async (c) => new EvalContextController().listThreads(c),
);

export default TopicsRoutes;
