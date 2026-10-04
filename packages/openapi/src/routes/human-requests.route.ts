import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { describeRoute } from 'hono-openapi';

import { isFullAccessApiKey } from '@/const/apiKeyScope';
import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { AgentHumanRequestController } from '../controllers/agent-human-request.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  AgentHumanRequestDecideRequestSchema,
  AgentHumanRequestIdParamSchema,
  AgentHumanRequestListQuerySchema,
} from '../types/agent-human-request.type';

/**
 * Human request routes — the approval and secure-input cards an agent parks
 * for its owner (outbound mail / SMS approval, verification codes).
 *
 * Reads are auth-only: rows are scoped to the owner (and workspace) inside the
 * model, so another user's card is a 404. Answering a card sends a message as
 * the agent, so it needs the same `message:create` grant a chat turn does —
 * and it is never open to a restricted API key: the answer is the human in
 * the loop, and a machine principal approving its own agent's outbound mail
 * would remove exactly that (mirrors `agentHumanRequest` in the tRPC rules).
 */
const HumanRequestRoutes = new Hono();

const noRestrictedApiKey = createMiddleware(async (c, next) => {
  if (c.get('authType') === 'apikey' && !isFullAccessApiKey(c.get('apiKeyScopes'))) {
    throw new HTTPException(403, {
      message: 'insufficient_scope: agent requests are answered by their owner, not an API key',
    });
  }
  await next();
});

const decideGate = requireAnyPermission(
  getAllScopePermissions('MESSAGE_CREATE'),
  'You do not have permission to answer agent requests',
);

/** GET /api/v1/human-requests */
HumanRequestRoutes.get(
  '/',
  describeRoute({
    operationId: 'listHumanRequests',
    summary: "List the approval and secure-input cards the caller's agents parked",
    tags: ['human-requests'],
  }),
  requireAuth,
  zValidator('query', AgentHumanRequestListQuerySchema),
  async (c) => new AgentHumanRequestController().list(c),
);

/** GET /api/v1/human-requests/identity — the server key clients pin (ASC TOFU). */
HumanRequestRoutes.get(
  '/identity',
  describeRoute({
    operationId: 'getHumanRequestSecretChannelIdentity',
    summary: 'Get the server Secret Channel identity to pin before sealing secrets',
    tags: ['human-requests'],
  }),
  requireAuth,
  async (c) => new AgentHumanRequestController().identity(c),
);

/** GET /api/v1/human-requests/:id */
HumanRequestRoutes.get(
  '/:id',
  describeRoute({
    operationId: 'getHumanRequest',
    summary: 'Get one approval or secure-input card',
    tags: ['human-requests'],
  }),
  requireAuth,
  zValidator('param', AgentHumanRequestIdParamSchema),
  async (c) => new AgentHumanRequestController().get(c),
);

/** POST /api/v1/human-requests/:id/decision */
HumanRequestRoutes.post(
  '/:id/decision',
  describeRoute({
    operationId: 'decideHumanRequest',
    summary: 'Approve (optionally edited), decline, retry, or fulfil a card with a sealed secret',
    tags: ['human-requests'],
  }),
  requireAuth,
  noRestrictedApiKey,
  decideGate,
  zValidator('param', AgentHumanRequestIdParamSchema),
  zValidator('json', AgentHumanRequestDecideRequestSchema),
  async (c) => new AgentHumanRequestController().decide(c),
);

export default HumanRequestRoutes;
