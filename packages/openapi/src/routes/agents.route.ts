import { Hono } from 'hono';

import { getAllScopePermissions, getScopePermissions } from '@/utils/rbac';

import {
  AGENT_EXAMPLE,
  AGENT_LIST_EXAMPLE,
  CREATE_AGENT_EXAMPLE,
  example,
} from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { AgentController } from '../controllers/agent.controller';
import { AgentAccountController } from '../controllers/agent-account.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission, requireApiKeyScope } from '../middleware/permission-check';
import {
  AgentDetailSchema,
  AgentIdParamSchema,
  AgentListSchema,
  AgentSchema,
  CreateAgentRequestSchema,
  DuplicateAgentSchema,
  GetAgentsQuerySchema,
  UpdateAgentRequestSchema,
} from '../types/agent.type';
import {
  AgentAccountAgentParamSchema,
  AgentAccountIdParamSchema,
  AgentAccountListQuerySchema,
  AgentAccountListSchema,
  AgentAccountSchema,
  CreateAgentAccountRequestSchema,
  RevokeAgentAccountQuerySchema,
  SetAgentAccountCredentialRequestSchema,
  UpdateAgentAccountRequestSchema,
} from '../types/agent-account.type';
import { DeletedResourceSchema } from '../types/common.type';

// Agent-related routes
const AgentRoutes = new Hono();

/**
 * Get the list of Agents in the system
 * GET /api/v1/agents
 * Requires Agent read permission
 */
AgentRoutes.get(
  '/',
  routeDoc({
    data: AgentListSchema,
    responseExample: AGENT_LIST_EXAMPLE,
    summary: 'List agents',
    tags: ['agents'],
  }),
  requireAuth,
  requireAnyPermission(
    getScopePermissions('AGENT_READ', ['ALL', 'OWNER']),
    'You do not have permission to view the Agent list',
  ),
  zValidator('query', GetAgentsQuerySchema),
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
  routeDoc({
    data: AgentSchema,
    requestExample: example(CreateAgentRequestSchema, CREATE_AGENT_EXAMPLE),
    responseExample: AGENT_EXAMPLE,
    summary: 'Create an agent',
    tags: ['agents'],
  }),
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
  routeDoc({
    data: AgentDetailSchema,
    errors: [404],
    summary: 'Get an agent with its mounted files and knowledge bases',
    tags: ['agents'],
  }),
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
  routeDoc({ data: AgentSchema, summary: 'Update an agent', tags: ['agents'] }),
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
  routeDoc({ data: DeletedResourceSchema, summary: 'Delete an agent', tags: ['agents'] }),
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
  routeDoc({
    data: AgentDetailSchema,
    errors: [404],
    status: 201,
    summary: 'Duplicate an agent',
    tags: ['agents'],
  }),
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AGENT_FORK')),
  zValidator('param', AgentIdParamSchema),
  zValidator('json', DuplicateAgentSchema),
  async (c) => new AgentController().duplicateAgent(c),
);

// ---------------------------------------------------------------------------
// Agent accounts — the identity assets an agent owns (mail / wallet / service). Reading them needs agent read; mounting or revoking one needs agent
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
  routeDoc({
    data: AgentAccountListSchema,
    errors: [404],
    summary: "List an agent's accounts",
    tags: ['agents'],
  }),
  requireAuth,
  agentAccountRead,
  zValidator('param', AgentAccountAgentParamSchema),
  zValidator('query', AgentAccountListQuerySchema),
  async (c) => new AgentAccountController().listAccounts(c),
);

/** POST /api/v1/agents/:id/accounts — mount an existing handle, or provision one. */
AgentRoutes.post(
  '/:id/accounts',
  routeDoc({
    data: AgentAccountSchema,
    errors: [404, 409],
    operationId: 'agents.createAccount',
    status: 201,
    summary: 'Mount or provision an agent account',
    tags: ['agents'],
  }),
  requireAuth,
  agentAccountWrite,
  zValidator('param', AgentAccountAgentParamSchema),
  zValidator('json', CreateAgentAccountRequestSchema),
  async (c) => new AgentAccountController().createAccount(c),
);

/** GET /api/v1/agents/:id/accounts/:accountId */
AgentRoutes.get(
  '/:id/accounts/:accountId',
  routeDoc({
    data: AgentAccountSchema,
    errors: [404],
    operationId: 'agents.getAccount',
    summary: 'Get an agent account',
    tags: ['agents'],
  }),
  requireAuth,
  agentAccountRead,
  zValidator('param', AgentAccountIdParamSchema),
  async (c) => new AgentAccountController().getAccount(c),
);

/** PATCH /api/v1/agents/:id/accounts/:accountId — non-secret fields only. */
AgentRoutes.patch(
  '/:id/accounts/:accountId',
  routeDoc({
    data: AgentAccountSchema,
    errors: [404, 409],
    operationId: 'agents.updateAccount',
    summary: 'Update an agent account',
    tags: ['agents'],
  }),
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
  routeDoc({
    data: AgentAccountSchema,
    description:
      'Write-only: the response carries the non-secret hint and `hasCredential`, never the secret.',
    errors: [404],
    operationId: 'agents.updateAccountCredential',
    summary: 'Write an agent account credential',
    tags: ['agents'],
  }),
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
  routeDoc({
    data: AgentAccountSchema,
    description:
      'Releases the account and marks it revoked. The row is kept for audit, so the response is the revoked account.',
    errors: [404],
    operationId: 'agents.deleteAccount',
    summary: 'Revoke an agent account',
    tags: ['agents'],
  }),
  requireAuth,
  agentAccountWrite,
  zValidator('param', AgentAccountIdParamSchema),
  zValidator('query', RevokeAgentAccountQuerySchema),
  async (c) => new AgentAccountController().revokeAccount(c),
);

export default AgentRoutes;
