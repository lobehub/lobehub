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

// Agent 相关路由
const AgentRoutes = new Hono();

/**
 * 获取系统中的 Agent 列表
 * GET /api/v1/agents
 * 需要 Agent 读取权限
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
 * 创建智能体
 * POST /api/v1/agents
 * 需要 Agent 创建权限
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
 * 根据 ID 获取 Agent 详情
 * GET /api/v1/agents/:id
 * 需要 Agent 读取权限
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
 * 更新智能体
 * PUT /api/v1/agents/:id
 * 需要 Agent 更新权限
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
 * 删除智能体
 * DELETE /api/v1/agents/:id
 * 需要 Agent 删除权限（仅管理员）
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
