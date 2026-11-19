import { Hono } from 'hono';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { AgentUsageController } from '../controllers/agent-usage.controller';
import { UsageController } from '../controllers/usage.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import {
  AgentUsageParamSchema,
  AgentUsageQuerySchema,
  AgentUsageStatsSchema,
  UsageSchema,
} from '../types/usage.type';

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

app.get(
  '/agents/:agentId',
  routeDoc({
    data: AgentUsageStatsSchema,
    description:
      "Tokens and spend of one agent's replies between `startAt` and `endAt` (both inclusive): a trend series bucketed by `granularity`, a per-model breakdown and totals. Inside a workspace it covers every member's conversations with a workspace agent the caller can view. An agent that is not the caller's, or not in the request's workspace, answers 404.",
    errors: [404],
    operationId: 'usage.getAgentUsage',
    summary: 'Get usage of one agent',
    tags: ['usage'],
  }),
  requireAuth,
  requireApiKeyScope('usage:read'),
  zValidator('param', AgentUsageParamSchema),
  zValidator('query', AgentUsageQuerySchema),
  async (c) => new AgentUsageController().getAgentUsage(c),
);

export default app;
