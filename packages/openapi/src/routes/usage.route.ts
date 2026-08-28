import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { getAllScopePermissions } from '@/utils/rbac';

import { UsageController } from '../controllers/usage.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermissionWithApiKeyScope } from '../middleware/permission-check';

const app = new Hono();

app.get(
  '/',
  describeRoute({ summary: 'Get usage and quota summary', tags: ['usage'] }),
  requireAuth,
  requireAnyPermissionWithApiKeyScope(getAllScopePermissions('API_KEY_READ'), 'usage:read'),
  async (c) => new UsageController().getUsage(c),
);

export default app;
