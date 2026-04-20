import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { MessageTranslationController } from '../controllers';
import { requireAuth } from '../middleware';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  MessageTranslateInfoUpdateSchema,
  MessageTranslateQueryRequestSchema,
  MessageTranslateTriggerRequestSchema,
} from '../types/message-translations.type';

// Message Translate related routes
const MessageTranslationRoutes = new Hono();

// POST /api/v1/message-translates - Translate specified message
MessageTranslationRoutes.post(
  '/:messageId',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('MESSAGE_READ'),
    'You do not have permission to read translated message',
  ),
  requireAnyPermission(
    getAllScopePermissions('TRANSLATION_CREATE'),
    'You do not have permission to translate message',
  ),
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
