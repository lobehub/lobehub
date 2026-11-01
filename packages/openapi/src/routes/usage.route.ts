import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { UsageController } from '../controllers/usage.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';

const app = new Hono();

app.get(
  '/',
  describeRoute({ summary: 'Get usage and quota summary', tags: ['usage'] }),
  requireAuth,
  // Every workspace member, viewers included, may read the pool balance and
  // their own allowance: `workspaceAuthMiddleware` has already checked the
  // membership, and the summary exposes no other member's figures.
  requireApiKeyScope('usage:read'),
  async (c) => new UsageController().getUsage(c),
);

export default app;
