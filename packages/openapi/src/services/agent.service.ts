import { and, count, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import type { NewAgent } from '@/database/schemas';
import { agents, agentsToSessions } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { idGenerator, randomSlug } from '@/database/utils/idGenerator';

import { BaseService } from '../common/base.service';
import { processPaginationConditions } from '../helpers/pagination';
import type { ServiceResult } from '../types';
import type {
  AgentDeleteRequest,
  AgentDetailResponse,
  AgentListResponse,
  CreateAgentRequest,
  GetAgentsRequest,
  UpdateAgentRequest,
} from '../types/agent.type';

/**
 * Agent service implementation class
 */
export class AgentService extends BaseService {
  constructor(db: LobeChatDatabase, userId: string | null) {
    super(db, userId);
  }

  /**
   * Get the user's Agent list
   * @param page Page number, starting from 1
   * @param pageSize Items per page, maximum 100
   * @returns The user's Agent list
   */
  async queryAgents(request: GetAgentsRequest): ServiceResult<AgentListResponse> {
    this.log('info', '获取 Agent 列表', { request });

    const { keyword } = request;

    try {
      // Base filter: current user + exclude virtual agents (inbox, supervisor, etc.)
      const baseConditions = and(
        eq(agents.userId, this.userId),
        or(eq(agents.virtual, false), isNull(agents.virtual)),
      );

      const whereConditions = keyword
        ? and(baseConditions, ilike(agents.title, `%${keyword}%`))
        : baseConditions;

      const query = this.db.query.agents.findMany({
        ...processPaginationConditions(request),
        orderBy: desc(agents.createdAt),
        where: whereConditions,
      });

      const countQuery = this.db.select({ count: count() }).from(agents).where(whereConditions);

      const [agentsList, totalResult] = await Promise.all([query, countQuery]);

      this.log('info', `查询到 ${agentsList.length} 个 Agent`);

      return {
        agents: agentsList,
        total: totalResult[0]?.count ?? 0,
      };
    } catch (error) {
      this.handleServiceError(error, '获取 Agent 列表');
    }
  }

  /**
   * Create an agent
   * @param request Create request parameters
   * @returns Created Agent info
   */
  async createAgent(request: CreateAgentRequest): ServiceResult<AgentDetailResponse> {
    this.log('info', '创建智能体', { title: request.title });

    try {
      return await this.db.transaction(async (tx) => {
        // Prepare creation data
        const newAgentData: NewAgent = {
          accessedAt: new Date(),
          avatar: request.avatar || null,
          chatConfig: request.chatConfig || null,
          createdAt: new Date(),
          description: request.description || null,
          id: idGenerator('agents'),
          model: request.model || null,
          params: request.params ?? {},
          provider: request.provider || null,
          slug: randomSlug(4), // Auto-generated slug
          systemRole: request.systemRole || null,
          title: request.title,
          updatedAt: new Date(),
          userId: this.userId,
        };

        // Insert into database
        const [createdAgent] = await tx.insert(agents).values(newAgentData).returning();
        this.log('info', 'Agent 创建成功', { id: createdAgent.id, slug: createdAgent.slug });

        return createdAgent;
      });
    } catch (error) {
      this.handleServiceError(error, '创建 Agent');
    }
  }

  /**
   * Update an agent
   * @param request Update request parameters
   * @returns Updated Agent info
   */
  async updateAgent(request: UpdateAgentRequest): ServiceResult<AgentDetailResponse> {
    this.log('info', '更新智能体', { id: request.id, title: request.title });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('AGENT_UPDATE', {
        targetAgentId: request.id,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权更新此 Agent');
      }

      return await this.db.transaction(async (tx) => {
        // Build query conditions
        const whereConditions = [eq(agents.id, request.id)];
        if (permissionResult.condition?.userId) {
          whereConditions.push(eq(agents.userId, permissionResult.condition.userId));
        }

        // Check if the Agent exists
        const existingAgent = await tx.query.agents.findFirst({
          where: and(...whereConditions),
        });

        if (!existingAgent) {
          throw this.createBusinessError(`Agent ID "${request.id}" 不存在`);
        }

        // Only update fields actually provided in the request to avoid overwriting existing values with undefined
        const updateData: Record<string, unknown> = { updatedAt: new Date() };

        if (request.avatar !== undefined) updateData.avatar = request.avatar ?? null;
        if (request.chatConfig !== undefined) updateData.chatConfig = request.chatConfig ?? null;
        if (request.description !== undefined) updateData.description = request.description ?? null;
        if (request.model !== undefined) updateData.model = request.model ?? null;
        if (request.provider !== undefined) updateData.provider = request.provider ?? null;
        if (request.systemRole !== undefined) updateData.systemRole = request.systemRole ?? null;
        if (request.title !== undefined) updateData.title = request.title;

        // Merge params instead of fully overwriting
        if (request.params !== undefined) {
          const existingParams = (existingAgent.params as Record<string, unknown>) ?? {};
          const incomingParams = request.params ?? {};
          const mergedParams = { ...existingParams };

          for (const [key, value] of Object.entries(incomingParams)) {
            if (value === undefined) {
              delete mergedParams[key];
            } else {
              mergedParams[key] = value;
            }
          }

          updateData.params = mergedParams;
        }

        // Update database
        const [updatedAgent] = await tx
          .update(agents)
          .set(updateData)
          .where(and(...whereConditions))
          .returning();

        this.log('info', 'Agent 更新成功', { id: updatedAgent.id, slug: updatedAgent.slug });
        return updatedAgent;
      });
    } catch (error) {
      this.handleServiceError(error, '更新 Agent');
    }
  }

  /**
   * Delete an agent
   * @param request Delete request parameters
   */
  async deleteAgent(request: AgentDeleteRequest): ServiceResult<void> {
    this.log('info', '删除智能体', {
      agentId: request.agentId,
      migrateSessionTo: request.migrateSessionTo,
    });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('AGENT_DELETE', {
        targetAgentId: request.agentId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权删除此 Agent');
      }

      // Check if the Agent to be deleted exists
      const targetAgent = await this.db.query.agents.findFirst({
        where: eq(agents.id, request.agentId),
      });

      if (!targetAgent) {
        throw this.createBusinessError(`Agent ID ${request.agentId} 不存在`);
      }

      if (request.migrateSessionTo) {
        // Validate that the migration target Agent exists and belongs to the current user
        const migrateTarget = await this.db.query.agents.findFirst({
          where: and(eq(agents.id, request.migrateSessionTo), eq(agents.userId, this.userId)),
        });

        if (!migrateTarget) {
          throw this.createBusinessError(`迁移目标 Agent ID ${request.migrateSessionTo} 不存在`);
        }

        // Migrate session associations to the target Agent
        await this.migrateAgentSessions(request.agentId, request.migrateSessionTo);

        this.log('info', '会话迁移完成', {
          from: request.agentId,
          to: request.migrateSessionTo,
        });

        // After migration, delete the agent itself directly; sessions have been transferred so cascade delete is not needed
        await this.db
          .delete(agents)
          .where(and(eq(agents.id, request.agentId), eq(agents.userId, this.userId)));
      } else {
        // No migration: reuse AgentModel.delete, which cascades deletion of associated sessions, messages, topics, etc.
        const agentModel = new AgentModel(this.db, this.userId);
        await agentModel.delete(request.agentId);
      }

      this.log('info', 'Agent 删除成功', { agentId: request.agentId });
    } catch (error) {
      this.handleServiceError(error, '删除 Agent');
    }
  }

  /**
   * Get Agent details by ID
   * @param agentId Agent ID
   * @returns Agent details
   */
  async getAgentById(agentId: string): ServiceResult<AgentDetailResponse | null> {
    this.log('info', '根据 ID 获取 Agent 详情', { agentId });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('AGENT_READ', {
        targetAgentId: agentId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(permissionResult.message || '无权访问此 Agent');
      }

      if (!this.userId) {
        throw this.createAuthError('未登录，无法获取 Agent 详情');
      }

      // Reuse AgentModel methods to get the full Agent configuration
      const agentModel = new AgentModel(this.db, this.userId);
      const agent = await agentModel.getAgentConfigById(agentId);

      if (!agent || !agent.id) {
        this.log('warn', 'Agent 不存在', { agentId });
        return null;
      }

      return agent as AgentDetailResponse;
    } catch (error) {
      this.handleServiceError(error, '获取 Agent 详情');
    }
  }

  /**
   * Migrate an Agent's sessions to another Agent
   * @param fromAgentId Source Agent ID
   * @param toAgentId Target Agent ID
   * @private
   */
  private async migrateAgentSessions(fromAgentId: string, toAgentId: string): Promise<void> {
    this.log('info', '开始迁移会话', { fromAgentId, toAgentId });

    try {
      await this.db.transaction(async (tx) => {
        // Get all sessionIds associated with the source Agent
        const links = await tx
          .select({ sessionId: agentsToSessions.sessionId })
          .from(agentsToSessions)
          .where(
            and(
              eq(agentsToSessions.agentId, fromAgentId),
              eq(agentsToSessions.userId, this.userId),
            ),
          );

        if (links.length === 0) return;

        const sessionIds = links.map((l) => l.sessionId);

        // Delete source agent's association records, then insert new records pointing to the target agent
        // Directly updating agentId may violate the unique constraint, so use delete + insert instead
        await tx
          .delete(agentsToSessions)
          .where(
            and(
              eq(agentsToSessions.agentId, fromAgentId),
              eq(agentsToSessions.userId, this.userId),
            ),
          );

        // Check if the target agent is already associated with these sessions to avoid duplicate inserts
        const existingLinks = await tx
          .select({ sessionId: agentsToSessions.sessionId })
          .from(agentsToSessions)
          .where(
            and(
              eq(agentsToSessions.agentId, toAgentId),
              inArray(agentsToSessions.sessionId, sessionIds),
            ),
          );

        const existingSessionIds = new Set(existingLinks.map((l) => l.sessionId));
        const newSessionIds = sessionIds.filter((id) => !existingSessionIds.has(id));

        if (newSessionIds.length > 0) {
          await tx.insert(agentsToSessions).values(
            newSessionIds.map((sessionId) => ({
              agentId: toAgentId,
              sessionId,
              userId: this.userId,
            })),
          );
        }

        this.log('info', '迁移会话完成', { count: newSessionIds.length });
      });

      this.log('info', '会话迁移成功', { fromAgentId, toAgentId });
    } catch (error) {
      this.handleServiceError(error, '会话迁移');
    }
  }
}
