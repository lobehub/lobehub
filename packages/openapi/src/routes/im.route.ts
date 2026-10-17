import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { ImController } from '../controllers/im.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requireApiKeyScope } from '../middleware/permission-check';
import {
  ImReadRequestSchema,
  ImSendRequestSchema,
  ImSyncQuerySchema,
  ImTopicParamSchema,
} from '../types/im.type';

/**
 * IM channel routes — the asynchronous, whole-message conversation surface for
 * messaging-style clients. No token streaming: `send` acknowledges, the agent
 * works in the background, `sync` long-polls for whole replies, typing and read
 * receipts.
 */
const ImRoutes = new Hono();

const messageRead = requireAnyPermission(
  getAllScopePermissions('MESSAGE_READ'),
  'You do not have permission to read messages',
);
const messageWrite = requireAnyPermission(
  getAllScopePermissions('MESSAGE_CREATE'),
  'You do not have permission to send messages',
);

/**
 * POST /api/v1/im/messages — send a message; the agent replies asynchronously.
 * Starts an agent run, so restricted keys need the same trio as `/responses`.
 */
ImRoutes.post(
  '/messages',
  describeRoute({
    operationId: 'sendImMessage',
    summary: 'Send a message to an agent; the reply arrives asynchronously via sync',
    tags: ['im'],
  }),
  requireAuth,
  messageWrite,
  requireApiKeyScope('model:invoke'),
  requireApiKeyScope('chat:write'),
  requireApiKeyScope('agent:write'),
  zValidator('json', ImSendRequestSchema),
  async (c) => new ImController().send(c),
);

/** GET /api/v1/im/topics/:topicId/sync — whole new messages, typing and read state (long-poll). */
ImRoutes.get(
  '/topics/:topicId/sync',
  describeRoute({
    operationId: 'syncImTopic',
    summary: 'Long-poll a conversation for whole new messages, typing and read receipts',
    tags: ['im'],
  }),
  requireAuth,
  messageRead,
  requireApiKeyScope('chat:read'),
  zValidator('param', ImTopicParamSchema),
  zValidator('query', ImSyncQuerySchema),
  async (c) => new ImController().sync(c),
);

/** POST /api/v1/im/topics/:topicId/read — move the user's read cursor forward. */
ImRoutes.post(
  '/topics/:topicId/read',
  describeRoute({
    operationId: 'markImTopicRead',
    summary: "Mark the agent's messages read up to a message",
    tags: ['im'],
  }),
  requireAuth,
  messageRead,
  requireApiKeyScope('chat:write'),
  zValidator('param', ImTopicParamSchema),
  zValidator('json', ImReadRequestSchema),
  async (c) => new ImController().markRead(c),
);

export default ImRoutes;
