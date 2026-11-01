import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { ChatController } from '../controllers/chat.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  ChatServiceParamsSchema,
  MessageGenerationParamsSchema,
  TranslateServiceParamsSchema,
} from '../types/chat.type';

const app = new Hono();
const requireModelInvoke = requireAnyPermission(getAllScopePermissions('AI_MODEL_INVOKE'));

app.post(
  '/',
  requireAuth,
  requireModelInvoke,
  zValidator('json', ChatServiceParamsSchema),
  async (c) => new ChatController().handleChat(c),
);

app.post(
  '/translate',
  requireAuth,
  requireModelInvoke,
  zValidator('json', TranslateServiceParamsSchema),
  async (c) => new ChatController().handleTranslate(c),
);

app.post(
  '/generate-reply',
  requireAuth,
  requireModelInvoke,
  zValidator('json', MessageGenerationParamsSchema),
  async (c) => new ChatController().handleGenerateReply(c),
);

export default app;
