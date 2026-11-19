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
import { AgentAdvancedController } from '../controllers/agent-advanced.controller';
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
import {
  AgentFileParamSchema,
  AgentKnowledgeBaseParamSchema,
  AgentKnowledgeSchema,
  AgentLabelParamSchema,
  AgentPinStateSchema,
  AgentSlugParamSchema,
  AgentVisibilityStateSchema,
  AttachAgentFilesRequestSchema,
  AttachAgentKnowledgeBaseRequestSchema,
  PinAgentRequestSchema,
  ResourceTransferResultSchema,
  SetAgentLabelsRequestSchema,
  ToggleAgentKnowledgeRequestSchema,
  TransferAgentRequestSchema,
  UpdateAgentVisibilityRequestSchema,
} from '../types/agent-advanced.type';
import { AgentLabelSetSchema } from '../types/agent-label.type';
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

// ---------------------------------------------------------------------------
// Advanced agent configuration: slug lookup, mounted knowledge, pin, labels,
// visibility and transfer. The rules live in the shared `agent` / `agentLabel`
// procedures; see `AgentAdvancedService`.
// ---------------------------------------------------------------------------
const agentRead = requireAnyPermission(
  getAllScopePermissions('AGENT_READ'),
  'You do not have permission to view this agent',
);
const agentWrite = requireAnyPermission(
  getAllScopePermissions('AGENT_UPDATE'),
  'You do not have permission to update this agent',
);
const agentLabelRead = requireAnyPermission(
  getAllScopePermissions('AGENT_LABEL_READ'),
  'You do not have permission to view agent labels',
);
const advanced = () => new AgentAdvancedController();

const WORKSPACE_SCOPED =
  'Resolved in the workspace named by `X-Workspace-Id` (or the personal space without it); an agent outside that scope answers 404.';

/** GET /api/v1/agents/by-slug/:slug */
AgentRoutes.get(
  '/by-slug/:slug',
  routeDoc({
    data: AgentDetailSchema,
    description: `Look an agent up by its URL slug instead of its id. Slugs are unique per scope; another account's or workspace's slug answers 404, so this cannot probe which slugs exist. ${WORKSPACE_SCOPED}`,
    errors: [404],
    operationId: 'agents.getBySlug',
    summary: 'Get an agent by slug',
    tags: ['agents'],
  }),
  requireAuth,
  agentRead,
  zValidator('param', AgentSlugParamSchema),
  async (c) => advanced().getAgentBySlug(c),
);

/** GET /api/v1/agents/:id/knowledge */
AgentRoutes.get(
  '/:id/knowledge',
  routeDoc({
    data: AgentKnowledgeSchema,
    description: `The files and knowledge bases mounted on the agent, each with its \`enabled\` flag (whether retrieval uses it). ${WORKSPACE_SCOPED}`,
    errors: [404],
    operationId: 'agents.getKnowledge',
    summary: "List an agent's mounted knowledge",
    tags: ['agents'],
  }),
  requireAuth,
  agentRead,
  zValidator('param', AgentIdParamSchema),
  async (c) => advanced().getKnowledge(c),
);

/** POST /api/v1/agents/:id/knowledge/files */
AgentRoutes.post(
  '/:id/knowledge/files',
  routeDoc({
    data: AgentKnowledgeSchema,
    description: `Mount files on the agent. Files already mounted are left as they are. Every file must be visible to the caller in the same scope; one that is not answers 404 and nothing is mounted. Needs edit access to the agent in a workspace. ${WORKSPACE_SCOPED}`,
    errors: [404],
    operationId: 'agents.attachFiles',
    summary: 'Mount files on an agent',
    tags: ['agents'],
  }),
  requireAuth,
  agentWrite,
  zValidator('param', AgentIdParamSchema),
  zValidator('json', AttachAgentFilesRequestSchema),
  async (c) => advanced().attachFiles(c),
);

/** PATCH /api/v1/agents/:id/knowledge/files/:fileId */
AgentRoutes.patch(
  '/:id/knowledge/files/:fileId',
  routeDoc({
    data: AgentKnowledgeSchema,
    description: `Turn a mounted file on or off for retrieval without unmounting it. ${WORKSPACE_SCOPED}`,
    errors: [404],
    operationId: 'agents.updateKnowledgeFile',
    summary: 'Enable or disable a mounted file',
    tags: ['agents'],
  }),
  requireAuth,
  agentWrite,
  zValidator('param', AgentFileParamSchema),
  zValidator('json', ToggleAgentKnowledgeRequestSchema),
  async (c) => advanced().updateFile(c),
);

/** DELETE /api/v1/agents/:id/knowledge/files/:fileId */
AgentRoutes.delete(
  '/:id/knowledge/files/:fileId',
  routeDoc({
    data: AgentKnowledgeSchema,
    description: `Unmount a file from the agent. The file itself is not deleted. ${WORKSPACE_SCOPED}`,
    errors: [404],
    operationId: 'agents.detachFile',
    summary: 'Unmount a file from an agent',
    tags: ['agents'],
  }),
  requireAuth,
  agentWrite,
  zValidator('param', AgentFileParamSchema),
  async (c) => advanced().detachFile(c),
);

/** POST /api/v1/agents/:id/knowledge/knowledge-bases */
AgentRoutes.post(
  '/:id/knowledge/knowledge-bases',
  routeDoc({
    data: AgentKnowledgeSchema,
    description: `Mount a knowledge base on the agent. A public workspace agent may only mount workspace-shared knowledge bases; a dedicated knowledge base cannot be mounted. Answers 409 when it is already mounted. ${WORKSPACE_SCOPED}`,
    errors: [404, 409],
    operationId: 'agents.attachKnowledgeBase',
    summary: 'Mount a knowledge base on an agent',
    tags: ['agents'],
  }),
  requireAuth,
  agentWrite,
  zValidator('param', AgentIdParamSchema),
  zValidator('json', AttachAgentKnowledgeBaseRequestSchema),
  async (c) => advanced().attachKnowledgeBase(c),
);

/** PATCH /api/v1/agents/:id/knowledge/knowledge-bases/:knowledgeBaseId */
AgentRoutes.patch(
  '/:id/knowledge/knowledge-bases/:knowledgeBaseId',
  routeDoc({
    data: AgentKnowledgeSchema,
    description: `Turn a mounted knowledge base on or off for retrieval without unmounting it. ${WORKSPACE_SCOPED}`,
    errors: [404],
    operationId: 'agents.updateKnowledgeBase',
    summary: 'Enable or disable a mounted knowledge base',
    tags: ['agents'],
  }),
  requireAuth,
  agentWrite,
  zValidator('param', AgentKnowledgeBaseParamSchema),
  zValidator('json', ToggleAgentKnowledgeRequestSchema),
  async (c) => advanced().updateKnowledgeBase(c),
);

/** DELETE /api/v1/agents/:id/knowledge/knowledge-bases/:knowledgeBaseId */
AgentRoutes.delete(
  '/:id/knowledge/knowledge-bases/:knowledgeBaseId',
  routeDoc({
    data: AgentKnowledgeSchema,
    description: `Unmount a knowledge base from the agent. The knowledge base itself is not deleted. ${WORKSPACE_SCOPED}`,
    errors: [404],
    operationId: 'agents.detachKnowledgeBase',
    summary: 'Unmount a knowledge base from an agent',
    tags: ['agents'],
  }),
  requireAuth,
  agentWrite,
  zValidator('param', AgentKnowledgeBaseParamSchema),
  async (c) => advanced().detachKnowledgeBase(c),
);

/** POST /api/v1/agents/:id/pin */
AgentRoutes.post(
  '/:id/pin',
  routeDoc({
    data: AgentPinStateSchema,
    description: `Pin (or, with \`pinned: false\`, unpin) the agent in the sidebar. On a public workspace agent the pin is the team pin every member sees, so only workspace owners and admins may set it; a private agent's pin is personal. ${WORKSPACE_SCOPED}`,
    errors: [404],
    operationId: 'agents.pin',
    summary: 'Pin or unpin an agent',
    tags: ['agents'],
  }),
  requireAuth,
  agentWrite,
  zValidator('param', AgentIdParamSchema),
  zValidator('json', PinAgentRequestSchema),
  async (c) => advanced().setPinned(c),
);

/** GET /api/v1/agents/:id/labels */
AgentRoutes.get(
  '/:id/labels',
  routeDoc({
    data: AgentLabelSetSchema,
    description: `The labels on the agent, from the caller's label registry (\`/agent-labels\`). ${WORKSPACE_SCOPED}`,
    errors: [404],
    operationId: 'agents.listLabels',
    summary: "List an agent's labels",
    tags: ['agents'],
  }),
  requireAuth,
  agentRead,
  agentLabelRead,
  zValidator('param', AgentIdParamSchema),
  async (c) => advanced().getLabels(c),
);

/** PUT /api/v1/agents/:id/labels */
AgentRoutes.put(
  '/:id/labels',
  routeDoc({
    data: AgentLabelSetSchema,
    description: `Replace the agent's whole label set. Labels not listed are removed; an archived label stays only if it was already on the agent. Every id must exist in the caller's registry, otherwise 404 and nothing changes. Prefer the single-label PUT/DELETE when other editors may be labelling concurrently. ${WORKSPACE_SCOPED}`,
    errors: [404],
    operationId: 'agents.setLabels',
    summary: "Replace an agent's labels",
    tags: ['agents'],
  }),
  requireAuth,
  agentWrite,
  agentLabelRead,
  zValidator('param', AgentIdParamSchema),
  zValidator('json', SetAgentLabelsRequestSchema),
  async (c) => advanced().setLabels(c),
);

/** PUT /api/v1/agents/:id/labels/:labelId */
AgentRoutes.put(
  '/:id/labels/:labelId',
  routeDoc({
    data: AgentLabelSetSchema,
    description: `Add one label to the agent. Idempotent; an archived label cannot be newly added (400). ${WORKSPACE_SCOPED}`,
    errors: [404],
    operationId: 'agents.addLabel',
    summary: 'Add a label to an agent',
    tags: ['agents'],
  }),
  requireAuth,
  agentWrite,
  agentLabelRead,
  zValidator('param', AgentLabelParamSchema),
  async (c) => advanced().addLabel(c),
);

/** DELETE /api/v1/agents/:id/labels/:labelId */
AgentRoutes.delete(
  '/:id/labels/:labelId',
  routeDoc({
    data: AgentLabelSetSchema,
    description: `Remove one label from the agent. The label stays in the registry. ${WORKSPACE_SCOPED}`,
    errors: [404],
    operationId: 'agents.removeLabel',
    summary: 'Remove a label from an agent',
    tags: ['agents'],
  }),
  requireAuth,
  agentWrite,
  agentLabelRead,
  zValidator('param', AgentLabelParamSchema),
  async (c) => advanced().removeLabel(c),
);

/** PATCH /api/v1/agents/:id/visibility */
AgentRoutes.patch(
  '/:id/visibility',
  routeDoc({
    data: AgentVisibilityStateSchema,
    description: `Publish a private workspace agent to the workspace (\`public\`, optionally with the members' \`accessLevel\`) or take it back to \`private\`. Only the agent's creator may make a published agent private, and it is refused while workspace tasks or group chats depend on it; builtin agents never change visibility. Workspace only: without \`X-Workspace-Id\` this answers 400. ${WORKSPACE_SCOPED}`,
    errors: [400, 404],
    operationId: 'agents.updateVisibility',
    summary: "Change an agent's workspace visibility",
    tags: ['agents'],
  }),
  requireAuth,
  agentWrite,
  zValidator('param', AgentIdParamSchema),
  zValidator('json', UpdateAgentVisibilityRequestSchema),
  async (c) => advanced().setVisibility(c),
);

/**
 * POST /api/v1/agents/:id/transfer
 *
 * Moving an agent out of its scope removes it from everyone who could reach
 * it, so a restricted key needs `agent:transfer` on top of `agent:write`
 * (two gates, as with agent credentials).
 */
AgentRoutes.post(
  '/:id/transfer',
  routeDoc({
    data: ResourceTransferResultSchema,
    description: `Move the agent to another workspace (\`targetWorkspaceId\`), to the caller's personal space (\`targetWorkspaceId: null\`), or hand it to another member of the current workspace (\`targetMemberId\`, which creates a pending request the recipient accepts in the product). Creator-only; the caller needs agent-create rights in the target workspace. Conversation history may keep migrating in the background (\`transferJobId\`). An API key is bound to one scope, so with API-key auth only the member handover is accepted; a move to another workspace or the personal space answers 403 and must be done in the product (or with a session/OIDC token). ${WORKSPACE_SCOPED}`,
    errors: [400, 404, 409],
    operationId: 'agents.transfer',
    summary: 'Transfer an agent',
    tags: ['agents'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_UPDATE'),
    'You do not have permission to transfer this agent',
  ),
  requireApiKeyScope('agent:transfer'),
  zValidator('param', AgentIdParamSchema),
  zValidator('json', TransferAgentRequestSchema),
  async (c) => advanced().transfer(c),
);

export default AgentRoutes;
