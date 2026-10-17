import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { getAllScopePermissions, getScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { AgentController } from '../controllers/agent.controller';
import { AgentAccountController } from '../controllers/agent-account.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requireApiKeyScope } from '../middleware/permission-check';
import { PaginationQuerySchema } from '../types';
import {
  AgentIdParamSchema,
  CreateAgentRequestSchema,
  DuplicateAgentSchema,
  UpdateAgentRequestSchema,
} from '../types/agent.type';
import {
  AgentAccountAgentParamSchema,
  AgentAccountIdParamSchema,
  AgentAccountListQuerySchema,
  CreateAgentAccountRequestSchema,
  RevokeAgentAccountQuerySchema,
  SetAgentAccountCredentialRequestSchema,
  UpdateAgentAccountRequestSchema,
} from '../types/agent-account.type';

// Agent-related routes
const AgentRoutes = new Hono();

/**
 * Get the list of Agents in the system
 * GET /api/v1/agents
 * Requires Agent read permission
 */
AgentRoutes.get(
  '/',
  requireAuth,
  requireAnyPermission(
    getScopePermissions('AGENT_READ', ['ALL', 'OWNER']),
    'You do not have permission to view the Agent list',
  ),
  zValidator('query', PaginationQuerySchema),
  async (c) => {
    const controller = new AgentController();
    return await controller.queryAgents(c);
  },
);

/**
 * Create an Agent
 * POST /api/v1/agents
 * Requires Agent create permission
 */
AgentRoutes.post(
  '/',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_CREATE'),
    'You do not have permission to create Agent',
  ),
  zValidator('json', CreateAgentRequestSchema),
  async (c) => {
    const controller = new AgentController();
    return await controller.createAgent(c);
  },
);

/**
 * Get Agent details by ID
 * GET /api/v1/agents/:id
 * Requires Agent read permission
 */
AgentRoutes.get(
  '/:id',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_READ'),
    'You do not have permission to view the Agent details',
  ),
  zValidator('param', AgentIdParamSchema),
  async (c) => {
    const controller = new AgentController();
    return await controller.getAgentById(c);
  },
);

/**
 * Update an Agent
 * PUT /api/v1/agents/:id
 * Requires Agent update permission
 */
AgentRoutes.patch(
  '/:id',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_UPDATE'),
    'You do not have permission to update Agent',
  ),
  zValidator('param', AgentIdParamSchema),
  zValidator('json', UpdateAgentRequestSchema),
  async (c) => {
    const controller = new AgentController();
    return await controller.updateAgent(c);
  },
);

/**
 * Delete an Agent
 * DELETE /api/v1/agents/:id
 * Requires Agent delete permission (admin only)
 */
AgentRoutes.delete(
  '/:id',
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_DELETE'),
    'You do not have permission to delete Agent',
  ),
  zValidator('param', AgentIdParamSchema),
  async (c) => {
    const controller = new AgentController();
    return await controller.deleteAgent(c);
  },
);

AgentRoutes.post(
  '/:id/duplicate',
  describeRoute({ summary: 'Duplicate agent', tags: ['agents'] }),
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AGENT_FORK')),
  zValidator('param', AgentIdParamSchema),
  zValidator('json', DuplicateAgentSchema),
  async (c) => new AgentController().duplicateAgent(c),
);

// ---------------------------------------------------------------------------
// Agent accounts — the identity assets an agent owns (mail / phone / wallet /
// service). Reading them needs agent read; mounting or revoking one needs agent
// write; installing a *credential* is its own write-only, high-risk act.
// ---------------------------------------------------------------------------
const agentAccountRead = requireAnyPermission(
  getAllScopePermissions('AGENT_READ'),
  "You do not have permission to view this agent's accounts",
);
const agentAccountWrite = requireAnyPermission(
  getAllScopePermissions('AGENT_UPDATE'),
  "You do not have permission to manage this agent's accounts",
);
/**
 * The issuer still needs `AGENT_UPDATE`, and a restricted API key must hold
 * both the scope `AGENT_UPDATE` projects to (`agent:write`) and the dedicated
 * `agent:credential:write` — "may manage this agent's accounts" must not imply
 * "may install a password into one", and the credential scope alone must not
 * stand in for agent write either. Applied as two gates: an explicit scope on
 * the RBAC check would replace the `agent:write` projection, not add to it.
 */
const agentAccountCredentialIssuer = requireAnyPermission(
  getAllScopePermissions('AGENT_UPDATE'),
  "You do not have permission to write this agent account's credential",
);
const agentAccountCredentialScope = requireApiKeyScope('agent:credential:write');

/** GET /api/v1/agents/:id/accounts — never returns a credential. */
AgentRoutes.get(
  '/:id/accounts',
  describeRoute({ operationId: 'listAgentAccounts', tags: ['agents'] }),
  requireAuth,
  agentAccountRead,
  zValidator('param', AgentAccountAgentParamSchema),
  zValidator('query', AgentAccountListQuerySchema),
  async (c) => new AgentAccountController().listAccounts(c),
);

/** POST /api/v1/agents/:id/accounts — mount an existing handle, or provision one. */
AgentRoutes.post(
  '/:id/accounts',
  describeRoute({ operationId: 'createAgentAccount', tags: ['agents'] }),
  requireAuth,
  agentAccountWrite,
  zValidator('param', AgentAccountAgentParamSchema),
  zValidator('json', CreateAgentAccountRequestSchema),
  async (c) => new AgentAccountController().createAccount(c),
);

/** GET /api/v1/agents/:id/accounts/:accountId */
AgentRoutes.get(
  '/:id/accounts/:accountId',
  describeRoute({ operationId: 'getAgentAccount', tags: ['agents'] }),
  requireAuth,
  agentAccountRead,
  zValidator('param', AgentAccountIdParamSchema),
  async (c) => new AgentAccountController().getAccount(c),
);

/** PATCH /api/v1/agents/:id/accounts/:accountId — non-secret fields only. */
AgentRoutes.patch(
  '/:id/accounts/:accountId',
  describeRoute({ operationId: 'updateAgentAccount', tags: ['agents'] }),
  requireAuth,
  agentAccountWrite,
  zValidator('param', AgentAccountIdParamSchema),
  zValidator('json', UpdateAgentAccountRequestSchema),
  async (c) => new AgentAccountController().updateAccount(c),
);

/**
 * PUT /api/v1/agents/:id/accounts/:accountId/credential
 *
 * The only path a secret enters an account, and it is write-only: the response
 * reports the hint and `hasCredential`, never the secret.
 */
AgentRoutes.put(
  '/:id/accounts/:accountId/credential',
  describeRoute({ operationId: 'setAgentAccountCredential', tags: ['agents'] }),
  requireAuth,
  agentAccountCredentialIssuer,
  agentAccountCredentialScope,
  zValidator('param', AgentAccountIdParamSchema),
  zValidator('json', SetAgentAccountCredentialRequestSchema),
  async (c) => new AgentAccountController().setCredential(c),
);

/** DELETE /api/v1/agents/:id/accounts/:accountId — release and revoke. */
AgentRoutes.delete(
  '/:id/accounts/:accountId',
  describeRoute({ operationId: 'revokeAgentAccount', tags: ['agents'] }),
  requireAuth,
  agentAccountWrite,
  zValidator('param', AgentAccountIdParamSchema),
  zValidator('query', RevokeAgentAccountQuerySchema),
  async (c) => new AgentAccountController().revokeAccount(c),
);

export default AgentRoutes;
