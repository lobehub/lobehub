import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { ChatController } from '../controllers/chat.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  ChatGenerateReplyResponseSchema,
  ChatResponseSchema,
  ChatServiceParamsSchema,
  ChatTranslateResponseSchema,
  MessageGenerationParamsSchema,
  TranslateServiceParamsSchema,
} from '../types/chat.type';

const app = new Hono();
const requireModelInvoke = requireAnyPermission(getAllScopePermissions('AI_MODEL_INVOKE'));

app.post(
  '/',
  routeDoc({
    data: ChatResponseSchema,
    summary: 'Run a non-streaming chat completion',
    tags: ['chat'],
  }),
  requireAuth,
  requireModelInvoke,
  zValidator('json', ChatServiceParamsSchema),
  async (c) => new ChatController().handleChat(c),
);

app.post(
  '/translate',
  routeDoc({ data: ChatTranslateResponseSchema, summary: 'Translate text', tags: ['chat'] }),
  requireAuth,
  requireModelInvoke,
  zValidator('json', TranslateServiceParamsSchema),
  async (c) => new ChatController().handleTranslate(c),
);

app.post(
  '/generate-reply',
  routeDoc({
    data: ChatGenerateReplyResponseSchema,
    summary: 'Generate a reply to a message',
    tags: ['chat'],
  }),
  requireAuth,
  requireModelInvoke,
  zValidator('json', MessageGenerationParamsSchema),
  async (c) => new ChatController().handleGenerateReply(c),
);

export default app;
