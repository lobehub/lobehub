import { and, asc, desc, eq } from 'drizzle-orm';

import { SessionGroupModel } from '@/database/models/sessionGroup';
import { sessionGroups } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { BaseService } from '../common/base.service';
import type { ServiceResult } from '../types';
import type {
  AgentGroupListResponse,
  CreateAgentGroupRequest,
  DeleteAgentGroupRequest,
  UpdateAgentGroupRequest,
} from '../types/agent-group.type';

/**
 * AgentGroup 服务实现类
 * 处理助理分类相关的业务逻辑
 */
export class AgentGroupService extends BaseService {
  private sessionGroupModel: SessionGroupModel;

  constructor(db: LobeChatDatabase, userId: string | null) {
    super(db, userId);
    this.sessionGroupModel = new SessionGroupModel(db, userId!);
  }

  /**
   * 获取助理分类列表
   * @returns 助理分类列表
   */
  async getAgentGroups(): ServiceResult<AgentGroupListResponse> {
    this.log('info', '获取助理分类列表');

    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('AGENT_READ');
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问助理分类列表');
      }

      // 构建查询条件
      const conditions = [];

      if (permissionResult.condition?.userId) {
        conditions.push(eq(sessionGroups.userId, permissionResult.condition.userId));
      }

      const agentGroupList = await this.db.query.sessionGroups.findMany({
        orderBy: [asc(sessionGroups.sort), desc(sessionGroups.createdAt)],
        where: and(...conditions),
      });

      this.log('info', `查询到 ${agentGroupList.length} 个助理分类`);

      return agentGroupList;
    } catch (error) {
      this.handleServiceError(error, '获取助理分类列表');
    }
  }

  /**
   * 根据 ID 获取助理分类详情
   * @param groupId 助理分类 ID
   * @returns 助理分类详情
   */
  async getAgentGroupById(groupId: string): ServiceResult<AgentGroupListResponse[0] | null> {
    try {
      this.log('info', '根据 ID 获取助理分类详情', { groupId });

      // 权限校验
      const permissionResult = await this.resolveOperationPermission('AGENT_READ');
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此助理分类');
      }

      // 构建查询条件
      const conditions = [eq(sessionGroups.id, groupId)];

      if (permissionResult.condition?.userId) {
        conditions.push(eq(sessionGroups.userId, permissionResult.condition.userId));
      }

      const agentGroup = await this.db.query.sessionGroups.findFirst({
        where: and(...conditions),
      });

      if (!agentGroup) {
        this.log('warn', '助理分类不存在', { groupId });
        return null;
      }

      return agentGroup;
    } catch (error) {
      this.handleServiceError(error, '获取助理分类详情');
    }
  }

  /**
   * 创建助理分类
   * @param request 创建请求参数
   * @returns 创建完成的助理分类 ID
   */
  async createAgentGroup(request: CreateAgentGroupRequest): ServiceResult<string> {
    this.log('info', '创建助理分类', { name: request.name, sort: request.sort });

    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('AGENT_CREATE');
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权创建助理分类');
      }

      const [result] = await this.db
        .insert(sessionGroups)
        .values({
          name: request.name,
          sort: request.sort,
          userId: this.userId,
        })
        .returning();

      if (!result) {
        throw this.createBusinessError('助理分类创建失败');
      }

      this.log('info', '助理分类创建成功', { id: result.id, name: request.name });
      return result.id;
    } catch (error) {
      this.handleServiceError(error, '创建助理分类');
    }
  }

  /**
   * 更新助理分类
   * @param request 更新请求参数
   * @returns 更新结果
   */
  async updateAgentGroup(request: UpdateAgentGroupRequest): ServiceResult<void> {
    this.log('info', '更新助理分类', { id: request.id, name: request.name });

    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('AGENT_UPDATE');
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权更新助理分类');
      }

      const { id, ...updateData } = request;

      // 检查助理分类是否存在
      const existingGroup = await this.sessionGroupModel.findById(id);
      if (!existingGroup) {
        throw this.createBusinessError(`助理分类 ID "${id}" 不存在`);
      }

      await this.db
        .update(sessionGroups)
        .set({ ...updateData, updatedAt: new Date() })
        .where(and(eq(sessionGroups.id, id), eq(sessionGroups.userId, this.userId)));

      this.log('info', '助理分类更新成功', { id });
    } catch (error) {
      this.handleServiceError(error, '更新助理分类');
    }
  }

  /**
   * 删除助理分类
   * @param request 删除请求参数
   * @returns 删除结果
   */
  async deleteAgentGroup(request: DeleteAgentGroupRequest): ServiceResult<void> {
    this.log('info', '删除助理分类', { id: request.id });

    try {
      // 权限校验
      const permissionResult = await this.resolveOperationPermission('AGENT_DELETE');
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权删除助理分类');
      }

      // 检查助理分类是否存在
      const existingGroup = await this.sessionGroupModel.findById(request.id);
      if (!existingGroup) {
        throw this.createBusinessError(`助理分类 ID "${request.id}" 不存在`);
      }

      // 构建查询条件
      const conditions = [eq(sessionGroups.id, request.id)];
      if (permissionResult.condition?.userId) {
        conditions.push(eq(sessionGroups.userId, permissionResult.condition.userId));
      }

      // 删除助理分类，分类内助理的 sessionGroupId 会通过数据库外键约束自动设为 null
      await this.db.delete(sessionGroups).where(and(...conditions));

      this.log('info', '助理分类删除成功', { id: request.id });
    } catch (error) {
      this.handleServiceError(error, '删除助理分类');
    }
  }
}
