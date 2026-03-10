import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { MessageController } from '../controllers';
import { requireAuth } from '../middleware';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  MessageIdParamSchema,
  MessagesCountQuerySchema,
  MessagesCreateRequestSchema,
  MessagesCreateWithReplyRequestSchema,
  MessagesDeleteBatchRequestSchema,
  MessagesListQuerySchema,
} from '../types/message.type';

// Messages-related routes
const MessageRoutes = new Hono();

// GET /api/v1/messages/count - Get message count (supports various filter conditions)
MessageRoutes.get(
  '/count',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_READ'),
    'You do not have permission to read message statistics',
  ),
  zValidator('query', MessagesCountQuerySchema),
  (c) => {
    const controller = new MessageController();
    return controller.handleCountMessages(c);
  },
);

// GET /api/v1/messages - Get message list (supports various filters and search)
MessageRoutes.get(
  '/',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_READ'),
    'You do not have permission to read messages',
  ),
  zValidator('query', MessagesListQuerySchema),
  (c) => {
    const controller = new MessageController();
    return controller.handleGetMessages(c);
  },
);

// GET /api/v1/messages/:id - Get message details by message ID (requires message read permission)
MessageRoutes.get(
  '/:id',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_READ'),
    'You do not have permission to read message details',
  ),
  zValidator('param', MessageIdParamSchema),
  (c) => {
    const controller = new MessageController();
    return controller.handleGetMessageById(c);
  },
);

// POST /api/v1/messages - Create a new message (requires message write permission)
MessageRoutes.post(
  '/',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_CREATE'),
    'You do not have permission to create messages',
  ),
  zValidator('json', MessagesCreateRequestSchema),
  (c) => {
    const controller = new MessageController();

    return controller.handleCreateMessage(c);
  },
);

// POST /api/v1/messages/replies - Create a user message and generate an AI reply (requires message write permission)
MessageRoutes.post(
  '/replies',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_CREATE'),
    'You do not have permission to create messages',
  ),
  zValidator('json', MessagesCreateWithReplyRequestSchema),
  (c) => {
    const controller = new MessageController();
    return controller.handleCreateMessageWithAIReply(c);
  },
);

// DELETE /api/v1/messages/:id - Delete a single message (requires message delete permission)
MessageRoutes.delete(
  '/:id',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_DELETE'),
    'You do not have permission to delete messages',
  ),
  zValidator('param', MessageIdParamSchema),
  (c) => {
    const controller = new MessageController();
    return controller.handleDeleteMessage(c);
  },
);

// DELETE /api/v1/messages - Batch delete messages (requires message delete permission)
MessageRoutes.delete(
  '/',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_DELETE'),
    'You do not have permission to delete messages',
  ),
  zValidator('json', MessagesDeleteBatchRequestSchema),
  (c) => {
    const controller = new MessageController();
    return controller.handleDeleteBatchMessages(c);
  },
);

export default MessageRoutes;
