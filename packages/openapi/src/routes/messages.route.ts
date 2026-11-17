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
  MessageAddFilesRequestSchema,
  MessageCountSchema,
  MessageIdParamSchema,
  MessageListSchema,
  MessageSchema,
  MessagesCountQuerySchema,
  MessagesCreateRequestSchema,
  MessagesCreateWithReplyRequestSchema,
  MessagesDeleteBatchRequestSchema,
  MessageSearchResultSchema,
  MessagesListQuerySchema,
  MessagesSearchQuerySchema,
  MessageStatsQuerySchema,
  MessageUpdateRequestSchema,
  TopicMessageStatsSchema,
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

// GET /api/v1/messages/search - Keyword search across messages, or within one topic
MessageRoutes.get(
  '/search',
  routeDoc({
    operationId: 'messages.search',
    data: MessageSearchResultSchema,
    description:
      "Without `topicId`, a full-text search over the caller's conversations, newest first; prompts written by automations are left out. With `topicId`, a literal, case-insensitive find over that topic's main conversation, oldest first (tool results and thread messages are skipped). Each hit carries a snippet around the match.",
    errors: [404],
    summary: 'Search messages',
    tags: ['messages'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_READ'),
    'You do not have permission to read messages',
  ),
  zValidator('query', MessagesSearchQuerySchema),
  (c) => new MessageController().handleSearchMessages(c),
);

// GET /api/v1/messages/stats - Distribution of message counts per topic
MessageRoutes.get(
  '/stats',
  routeDoc({
    operationId: 'messages.topicStats',
    data: TopicMessageStatsSchema,
    description:
      'How many messages topics hold: count, mean, median, p90/p99, one-shot ratio and a histogram, over the topics that have at least one matching message.',
    summary: 'Get message statistics per topic',
    tags: ['messages'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_READ'),
    'You do not have permission to read message statistics',
  ),
  zValidator('query', MessageStatsQuerySchema),
  (c) => new MessageController().handleTopicStats(c),
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

// PATCH /api/v1/messages/:id - Edit a message (content, metadata, tool state and arguments)
MessageRoutes.patch(
  '/:id',
  routeDoc({
    data: MessageSchema,
    description:
      'Applies every field given: `content` replaces the text, `metadata` is merged in (server-owned keys are ignored), `pluginState` / `pluginError` update a `tool` message, and `toolArguments` rewrites one tool call this message made or answers.',
    errors: [404],
    summary: 'Update a message',
    tags: ['messages'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_UPDATE'),
    'You do not have permission to update messages',
  ),
  zValidator('param', MessageIdParamSchema),
  zValidator('json', MessageUpdateRequestSchema),
  (c) => new MessageController().handleUpdateMessage(c),
);

// POST /api/v1/messages/:id/files - Attach uploaded files to a message
MessageRoutes.post(
  '/:id/files',
  routeDoc({
    operationId: 'messages.addFiles',
    data: MessageSchema,
    description:
      'Links files already uploaded through `/files` to the message; it answers the message with its full file list.',
    errors: [404],
    summary: 'Attach files to a message',
    tags: ['messages'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_UPDATE'),
    'You do not have permission to update messages',
  ),
  zValidator('param', MessageIdParamSchema),
  zValidator('json', MessageAddFilesRequestSchema),
  (c) => new MessageController().handleAddFiles(c),
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
