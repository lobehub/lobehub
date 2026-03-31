import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { getAllScopePermissions, getScopePermissions } from '@/utils/rbac';

import { AgentController } from '../controllers/agent.controller';
import { requireAuth } from '../middleware/auth';
import { requireAnyPermission } from '../middleware/permission-check';
import { PaginationQuerySchema } from '../types';
import {
  AgentIdParamSchema,
  CreateAgentRequestSchema,
  UpdateAgentRequestSchema,
} from '../types/agent.type';

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

export default AgentRoutes;
