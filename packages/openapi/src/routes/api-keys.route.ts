import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { ApiKeyController } from '../controllers/api-key.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  ApiKeyIdParamSchema,
  CreateApiKeyRequestSchema,
  UpdateApiKeyRequestSchema,
} from '../types/api-key.type';

const app = new Hono();

app.get(
  '/',
  describeRoute({ summary: 'List API keys', tags: ['api-keys'] }),
  requireAuth,
  requireAnyPermission(getAllScopePermissions('API_KEY_READ')),
  async (c) => new ApiKeyController().getApiKeys(c),
);

app.post(
  '/',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('API_KEY_CREATE')),
  zValidator('json', CreateApiKeyRequestSchema),
  async (c) => new ApiKeyController().createApiKey(c),
);

app.get(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('API_KEY_READ')),
  zValidator('param', ApiKeyIdParamSchema),
  async (c) => new ApiKeyController().getApiKey(c),
);

app.patch(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('API_KEY_UPDATE')),
  zValidator('param', ApiKeyIdParamSchema),
  zValidator('json', UpdateApiKeyRequestSchema),
  async (c) => new ApiKeyController().updateApiKey(c),
);

app.delete(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('API_KEY_DELETE')),
  zValidator('param', ApiKeyIdParamSchema),
  async (c) => new ApiKeyController().deleteApiKey(c),
);

export default app;
