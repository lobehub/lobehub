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

// AgentGroup 相关路由（助理分类）
const AgentGroupRoutes = new Hono();

/**
 * 获取助理分类列表
 * GET /api/v1/agent-groups
 * 需要助理读取权限
 */
AgentGroupRoutes.get(
  '/',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AGENT_READ'), '您没有权限查看助理分类列表'),
  async (c) => {
    const controller = new AgentGroupController();
    return await controller.getAgentGroups(c);
  },
);

/**
 * 创建助理分类
 * POST /api/v1/agent-groups
 * 需要助理创建权限
 */
AgentGroupRoutes.post(
  '/',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AGENT_CREATE'), '您没有权限创建助理分类'),
  zValidator('json', CreateAgentGroupRequestSchema),
  async (c) => {
    const controller = new AgentGroupController();
    return await controller.createAgentGroup(c);
  },
);

/**
 * 根据 ID 获取助理分类详情
 * GET /api/v1/agent-groups/:id
 * 需要助理读取权限
 */
AgentGroupRoutes.get(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AGENT_READ'), '您没有权限查看助理分类详情'),
  zValidator('param', AgentGroupIdParamSchema),
  async (c) => {
    const controller = new AgentGroupController();
    return await controller.getAgentGroupById(c);
  },
);

/**
 * 更新助理分类
 * PATCH /api/v1/agent-groups/:id
 * 需要助理更新权限
 */
AgentGroupRoutes.patch(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AGENT_UPDATE'), '您没有权限更新助理分类'),
  zValidator('param', AgentGroupIdParamSchema),
  zValidator('json', UpdateAgentGroupRequestSchema),
  async (c) => {
    const controller = new AgentGroupController();
    return await controller.updateAgentGroup(c);
  },
);

/**
 * 删除助理分类
 * DELETE /api/v1/agent-groups/:id
 * 需要助理删除权限
 *
 * 行为说明:
 * - 删除指定的助理分类
 * - 分类内助理不会被删除，会自动变为未分类状态（sessionGroupId 设为 null）
 */
AgentGroupRoutes.delete(
  '/:id',
  requireAuth,
  requireAnyPermission(getAllScopePermissions('AGENT_DELETE'), '您没有权限删除助理分类'),
  zValidator('param', AgentGroupIdParamSchema),
  async (c) => {
    const controller = new AgentGroupController();
    return await controller.deleteAgentGroup(c);
  },
);

export default AgentGroupRoutes;
