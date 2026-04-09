import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { AgentGroupController } from '../controllers/agent-group.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import {
  AgentGroupIdParamSchema,
  CreateAgentGroupRequestSchema,
  UpdateAgentGroupRequestSchema,
} from '../types/agent-group.type';

// AgentGroup-related routes (agent groups)
const AgentGroupRoutes = new Hono();

/**
 * Get agent group list
 * GET /api/v1/agent-groups
 * Requires agent read permission
 */
AgentGroupRoutes.get(
  '/',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AGENT_READ'), 'You do not have permission to view agent group list'),
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
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AGENT_CREATE'), 'You do not have permission to create an agent group'),
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
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AGENT_READ'), 'You do not have permission to view agent group details'),
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
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AGENT_UPDATE'), 'You do not have permission to update an agent group'),
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
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AGENT_DELETE'), 'You do not have permission to delete an agent group'),
  zValidator('param', AgentGroupIdParamSchema),
  async (c) => {
    const controller = new AgentGroupController();
    return await controller.deleteAgentGroup(c);
  },
);

export default AgentGroupRoutes;
