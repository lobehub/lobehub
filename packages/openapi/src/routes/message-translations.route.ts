import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { MessageTranslationController } from '../controllers';
import { requireAuth } from '../middleware';
import { requireAnyPermission, requireApiKeyScope } from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  MessageTranslateInfoUpdateSchema,
  MessageTranslateQueryRequestSchema,
  MessageTranslateTriggerRequestSchema,
  MessageTranslationSchema,
  MessageTranslationWriteSchema,
} from '../types/message-translations.type';

// Message Translate related routes
const MessageTranslationRoutes = new Hono();

// POST /api/v1/message-translates - Translate specified message
MessageTranslationRoutes.post(
  '/:messageId',
  routeDoc({
    data: MessageTranslationWriteSchema,
    summary: 'Translate a message',
    tags: ['message-translations'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_READ'),
    'You do not have permission to read translated message',
  ),
  requireAnyPermission(
    getAllScopePermissions('TRANSLATION_CREATE'),
    'You do not have permission to translate message',
  ),
  // Translation invokes a model, so restricted API keys also need `model:invoke`
  requireApiKeyScope('model:invoke'),
  zValidator('param', MessageTranslateQueryRequestSchema),
  zValidator('json', MessageTranslateTriggerRequestSchema),
  (c) => {
    const controller = new MessageTranslationController();
    return controller.handleTranslateMessage(c);
  },
);

// GET /api/v1/message-translates - Get translation info for specified message
MessageTranslationRoutes.get(
  '/:messageId',
  routeDoc({
    data: MessageTranslationSchema.nullable(),
    description: '`null` when the message has no stored translation.',
    summary: "Get a message's translation",
    tags: ['message-translations'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_READ'),
    'You do not have permission to read message translations',
  ),
  requireAnyPermission(
    getAllScopePermissions('TRANSLATION_READ'),
    'You do not have permission to read message translations',
  ),
  zValidator('param', MessageTranslateQueryRequestSchema),
  (c) => {
    const controller = new MessageTranslationController();
    return controller.handleGetTranslateByMessage(c);
  },
);

// PUT /api/v1/message-translates/:messageId - Update message translation info
MessageTranslationRoutes.patch(
  '/:messageId',
  routeDoc({
    data: MessageTranslationWriteSchema,
    summary: "Set a message's translation",
    tags: ['message-translations'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_UPDATE'),
    'You do not have permission to update translation configuration',
  ),
  requireAnyPermission(
    getAllScopePermissions('TRANSLATION_UPDATE'),
    'You do not have permission to update message translations',
  ),
  zValidator('param', MessageTranslateQueryRequestSchema),
  zValidator('json', MessageTranslateInfoUpdateSchema),
  (c) => {
    const controller = new MessageTranslationController();
    return controller.handleUpdateTranslateInfo(c);
  },
);

// DELETE /api/v1/message-translates/:messageId - Delete message translation info
MessageTranslationRoutes.delete(
  '/:messageId',
  routeDoc({
    data: DeletedResourceSchema,
    description: '`id` is the id of the message whose translation was removed.',
    errors: [404],
    summary: "Delete a message's translation",
    tags: ['message-translations'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('TRANSLATION_DELETE'),
    'You do not have permission to delete translation',
  ),
  zValidator('param', MessageTranslateQueryRequestSchema),
  (c) => {
    const controller = new MessageTranslationController();
    return controller.handleDeleteTranslate(c);
  },
);

export default MessageTranslationRoutes;
