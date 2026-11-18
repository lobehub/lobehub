import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { AgentGroupController } from '../controllers/agent-group.controller';
import {
  LEGACY_ARRAY_LIST_DESCRIPTION,
  LegacyArrayListQuerySchema,
} from '../helpers/legacy-array-list';
import { paginatedListSchema } from '../helpers/pagination';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  AgentGroupIdParamSchema,
  AgentGroupSchema,
  CreateAgentGroupRequestSchema,
  CreatedAgentGroupSchema,
  UpdateAgentGroupRequestSchema,
} from '../types/agent-group.type';
import { DeletedResourceSchema } from '../types/common.type';

// AgentGroup-related routes (agent groups)
const AgentGroupRoutes = new Hono();

/**
 * Get agent group list
 * GET /api/v1/agent-groups
 * Requires agent read permission
 */
AgentGroupRoutes.get(
  '/',
  routeDoc({
    data: paginatedListSchema(AgentGroupSchema, { total: true }),
    description: LEGACY_ARRAY_LIST_DESCRIPTION,
    summary: 'List agent groups',
    tags: ['agent-groups'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_READ'),
    'You do not have permission to view agent group list',
  ),
  zValidator('query', LegacyArrayListQuerySchema),
  async (c) => {
    const controller = new AgentGroupController();
    return await controller.getAgentGroups(c);
  },
);

/**
 * Create an agent group
 * POST /api/v1/agent-groups
 * Requires agent create permission
 */
AgentGroupRoutes.post(
  '/',
  routeDoc({
    data: CreatedAgentGroupSchema,
    status: 201,
    summary: 'Create an agent group',
    tags: ['agent-groups'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_CREATE'),
    'You do not have permission to create an agent group',
  ),
  zValidator('json', CreateAgentGroupRequestSchema),
  async (c) => {
    const controller = new AgentGroupController();
    return await controller.createAgentGroup(c);
  },
);

/**
 * Get agent group details by ID
 * GET /api/v1/agent-groups/:id
 * Requires agent read permission
 */
AgentGroupRoutes.get(
  '/:id',
  routeDoc({
    data: AgentGroupSchema,
    errors: [404],
    summary: 'Get an agent group',
    tags: ['agent-groups'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_READ'),
    'You do not have permission to view agent group details',
  ),
  zValidator('param', AgentGroupIdParamSchema),
  async (c) => {
    const controller = new AgentGroupController();
    return await controller.getAgentGroupById(c);
  },
);

/**
 * Update an agent group
 * PATCH /api/v1/agent-groups/:id
 * Requires agent update permission
 */
AgentGroupRoutes.patch(
  '/:id',
  routeDoc({
    data: AgentGroupSchema,
    summary: 'Update an agent group',
    tags: ['agent-groups'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_UPDATE'),
    'You do not have permission to update an agent group',
  ),
  zValidator('param', AgentGroupIdParamSchema),
  zValidator('json', UpdateAgentGroupRequestSchema),
  async (c) => {
    const controller = new AgentGroupController();
    return await controller.updateAgentGroup(c);
  },
);

/**
 * Delete an agent group
 * DELETE /api/v1/agent-groups/:id
 * Requires agent delete permission
 *
 * Behavior:
 * - Deletes the specified agent group
 * - Agents within the group are not deleted; they become uncategorized (sessionGroupId set to null)
 */
AgentGroupRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    summary: 'Delete an agent group',
    tags: ['agent-groups'],
  }),
  requireAuth,
  requireAnyPermission(
    getAllScopePermissions('AGENT_DELETE'),
    'You do not have permission to delete an agent group',
  ),
  zValidator('param', AgentGroupIdParamSchema),
  async (c) => {
    const controller = new AgentGroupController();
    return await controller.deleteAgentGroup(c);
  },
);

export default AgentGroupRoutes;
