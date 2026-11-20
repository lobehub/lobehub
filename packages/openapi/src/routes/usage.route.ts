import { Hono } from 'hono';

import { routeDoc } from '../common/openapi';
import { UsageController } from '../controllers/usage.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import { UsageSchema } from '../types/usage.type';

const app = new Hono();

app.get(
  '/',
  routeDoc({ data: UsageSchema, summary: 'Get usage and quota summary', tags: ['usage'] }),
  requireAuth,
  // Every workspace member, viewers included, may read the pool balance and
  // their own allowance: `workspaceAuthMiddleware` has already checked the
  // membership, and the summary exposes no other member's figures.
  requireApiKeyScope('usage:read'),
  async (c) => new UsageController().getUsage(c),
);

export default app;
