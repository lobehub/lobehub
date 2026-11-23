import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import {
  CREATE_MESSAGE_EXAMPLE,
  example,
  MESSAGE_EXAMPLE,
  MESSAGE_LIST_EXAMPLE,
} from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { MessageController } from '../controllers';
import { requireAuth } from '../middleware';
import { requireAnyPermission, requireApiKeyScope } from '../middleware/permission-check';
import { DeletedResourceSchema, DeletedResourcesSchema } from '../types/common.type';
import {
  MessageCountSchema,
  MessageIdParamSchema,
  MessageListSchema,
  MessageSchema,
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
  routeDoc({ data: MessageCountSchema, summary: 'Count messages', tags: ['messages'] }),
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
  routeDoc({
    data: MessageListSchema,
    responseExample: MESSAGE_LIST_EXAMPLE,
    summary: 'List messages',
    tags: ['messages'],
  }),
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
  routeDoc({ data: MessageSchema, errors: [404], summary: 'Get a message', tags: ['messages'] }),
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
  routeDoc({
    data: MessageSchema,
    requestExample: example(MessagesCreateRequestSchema, CREATE_MESSAGE_EXAMPLE),
    responseExample: MESSAGE_EXAMPLE,
    summary: 'Create a message',
    tags: ['messages'],
  }),
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
// Generating the reply invokes a model, so restricted API keys also need `model:invoke`
MessageRoutes.post(
  '/replies',
  routeDoc({
    operationId: 'messages.createReply',
    data: MessageSchema.nullable(),
    description:
      'Stores the user message, then generates and stores the assistant reply. Answers with the reply; `null` only if it could not be read back.',
    summary: 'Create a user message and generate an AI reply',
    tags: ['messages'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_CREATE'),
    'You do not have permission to create messages',
  ),
  requireApiKeyScope('model:invoke'),
  zValidator('json', MessagesCreateWithReplyRequestSchema),
  (c) => {
    const controller = new MessageController();
    return controller.handleCreateMessageWithAIReply(c);
  },
);

// DELETE /api/v1/messages/:id - Delete a single message (requires message delete permission)
MessageRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    errors: [404],
    summary: 'Delete a message',
    tags: ['messages'],
  }),
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
  routeDoc({
    operationId: 'messages.deleteMany',
    data: DeletedResourcesSchema,
    description:
      'Best effort: ids the caller may not delete or that no longer exist are skipped. `count` is the number of messages actually removed.',
    summary: 'Delete messages in batch',
    tags: ['messages'],
  }),
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
