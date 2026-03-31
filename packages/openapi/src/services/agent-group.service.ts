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
 * AgentGroup service implementation class
 * Handles business logic related to agent group categories
 */
export class AgentGroupService extends BaseService {
  private sessionGroupModel: SessionGroupModel;

  constructor(db: LobeChatDatabase, userId: string | null) {
    super(db, userId);
    this.sessionGroupModel = new SessionGroupModel(db, userId!);
  }

  /**
   * Get agent group list
   * @returns Agent group list
   */
  async getAgentGroups(): ServiceResult<AgentGroupListResponse> {
    this.log('info', 'Getting agent group list');

    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('AGENT_READ');
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问助理分类列表');
      }

      // Build query conditions
      const conditions = [];

      if (permissionResult.condition?.userId) {
        conditions.push(eq(sessionGroups.userId, permissionResult.condition.userId));
      }

      const agentGroupList = await this.db.query.sessionGroups.findMany({
        orderBy: [asc(sessionGroups.sort), desc(sessionGroups.createdAt)],
        where: and(...conditions),
      });

      this.log('info', `Found ${agentGroupList.length} agent groups`);

      return agentGroupList;
    } catch (error) {
      this.handleServiceError(error, '获取助理分类列表');
    }
  }

  /**
   * Get agent group detail by ID
   * @param groupId Agent group ID
   * @returns Agent group detail
   */
  async getAgentGroupById(groupId: string): ServiceResult<AgentGroupListResponse[0] | null> {
    try {
      this.log('info', 'Getting agent group detail by ID', { groupId });

      // Permission check
      const permissionResult = await this.resolveOperationPermission('AGENT_READ');
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此助理分类');
      }

      // Build query conditions
      const conditions = [eq(sessionGroups.id, groupId)];

      if (permissionResult.condition?.userId) {
        conditions.push(eq(sessionGroups.userId, permissionResult.condition.userId));
      }

      const agentGroup = await this.db.query.sessionGroups.findFirst({
        where: and(...conditions),
      });

      if (!agentGroup) {
        this.log('warn', 'Agent group not found', { groupId });
        return null;
      }

      return agentGroup;
    } catch (error) {
      this.handleServiceError(error, '获取助理分类详情');
    }
  }

  /**
   * Create agent group
   * @param request Create request parameters
   * @returns ID of the created agent group
   */
  async createAgentGroup(request: CreateAgentGroupRequest): ServiceResult<string> {
    this.log('info', 'Creating agent group', { name: request.name, sort: request.sort });

    try {
      // Permission check
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

      this.log('info', 'Agent group created successfully', { id: result.id, name: request.name });
      return result.id;
    } catch (error) {
      this.handleServiceError(error, '创建助理分类');
    }
  }

  /**
   * Update agent group
   * @param request Update request parameters
   * @returns Update result
   */
  async updateAgentGroup(request: UpdateAgentGroupRequest): ServiceResult<void> {
    this.log('info', 'Updating agent group', { id: request.id, name: request.name });

    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('AGENT_UPDATE');
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权更新助理分类');
      }

      const { id, ...updateData } = request;

      // Check if agent group exists
      const existingGroup = await this.sessionGroupModel.findById(id);
      if (!existingGroup) {
        throw this.createBusinessError(`助理分类 ID "${id}" 不存在`);
      }

      await this.db
        .update(sessionGroups)
        .set({ ...updateData, updatedAt: new Date() })
        .where(and(eq(sessionGroups.id, id), eq(sessionGroups.userId, this.userId)));

      this.log('info', 'Agent group updated successfully', { id });
    } catch (error) {
      this.handleServiceError(error, '更新助理分类');
    }
  }

  /**
   * Delete agent group
   * @param request Delete request parameters
   * @returns Deletion result
   */
  async deleteAgentGroup(request: DeleteAgentGroupRequest): ServiceResult<void> {
    this.log('info', 'Deleting agent group', { id: request.id });

    try {
      // Permission check
      const permissionResult = await this.resolveOperationPermission('AGENT_DELETE');
      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权删除助理分类');
      }

      // Check if agent group exists
      const existingGroup = await this.sessionGroupModel.findById(request.id);
      if (!existingGroup) {
        throw this.createBusinessError(`助理分类 ID "${request.id}" 不存在`);
      }

      // Build query conditions
      const conditions = [eq(sessionGroups.id, request.id)];
      if (permissionResult.condition?.userId) {
        conditions.push(eq(sessionGroups.userId, permissionResult.condition.userId));
      }

      // Delete agent group; the sessionGroupId of agents in the group will be automatically set to null via database foreign key constraint
      await this.db.delete(sessionGroups).where(and(...conditions));

      this.log('info', 'Agent group deleted successfully', { id: request.id });
    } catch (error) {
      this.handleServiceError(error, '删除助理分类');
    }
  }
}
