import { and, count, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';

import { assertAgentDeletionAllowed } from '@/business/server/agent-share/assertAgentOwnershipTransferAllowed';
import { AgentModel } from '@/database/models/agent';
import type { ActiveShareRun } from '@/database/models/topic';
import { TopicModel } from '@/database/models/topic';
import type { FileItem, KnowledgeBaseItem, NewAgent } from '@/database/schemas';
import { agents, agentsToSessions } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { writeAgentConfigWithShareReset } from '@/database/utils/agentConfigShareReset';
import { idGenerator, randomSlug } from '@/database/utils/idGenerator';
import { isWorkspacePrimaryOwner } from '@/server/services/workspacePermission';

import { BaseService } from '../common/base.service';
import { resolveClearedAgencyConfig } from '../helpers/agent-policy-keys';
import { mergeJsonPatch } from '../helpers/json-patch';
import { processPaginationConditions } from '../helpers/pagination';
import {
  projectPublicAgent,
  projectPublicFile,
  projectPublicKnowledgeBase,
} from '../helpers/public-fields';
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
  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
  }

  /**
   * Get the user's Agent list
   * @param page Page number, starting from 1
   * @param pageSize Items per page, maximum 100
   * @returns The user's Agent list
   */
  async queryAgents(request: GetAgentsRequest): ServiceResult<AgentListResponse> {
    this.log('info', 'get agent list', { request });

    const { keyword } = request;

    try {
      // Base filter: current user + exclude virtual agents (inbox, supervisor, etc.)
      const baseConditions = and(
        this.buildWorkspaceWhere(agents),
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

      this.log('info', `found ${agentsList.length} agents`);

      return {
        agents: agentsList.map(projectPublicAgent),
        total: totalResult[0]?.count ?? 0,
      };
    } catch (error) {
      this.handleServiceError(error, 'get agent list');
    }
  }

  /**
   * Create an agent
   * @param request Create request parameters
   * @returns Created Agent info
   */
  async createAgent(request: CreateAgentRequest): ServiceResult<AgentDetailResponse> {
    this.log('info', 'create agent', { title: request.title });

    try {
      return await this.db.transaction(async (tx) => {
        // Prepare creation data
        const newAgentData: NewAgent = {
          accessedAt: new Date(),
          agencyConfig: request.agencyConfig || null,
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
          ...this.buildWorkspacePayload({}),
        };

        // Insert into database
        const [createdAgent] = await tx.insert(agents).values(newAgentData).returning();
        this.log('info', 'agent created successfully', {
          id: createdAgent.id,
          slug: createdAgent.slug,
        });

        return projectPublicAgent(createdAgent);
      });
    } catch (error) {
      this.handleServiceError(error, 'create agent');
    }
  }

  /**
   * Update an agent
   * @param request Update request parameters
   * @param options.onShareReset Invoked when this write actually flips a
   *   `link` share back to `private` (see `writeAgentConfigWithShareReset`'s
   *   `onShareReset`). `packages/openapi` cannot import `AiAgentService`
   *   (apps/server) to schedule the visitor-run interrupt itself — this
   *   package must not depend on an app — so the caller (the controller,
   *   which forwards it to the HTTP boundary that CAN reach apps/server) has
   *   to supply the hook.
   * @returns Updated Agent info
   */
  async updateAgent(
    request: UpdateAgentRequest,
    options?: {
      onShareReset?: (params: { agentId: string; ownerId: string }) => void;
    },
  ): ServiceResult<AgentDetailResponse> {
    this.log('info', 'update agent', { id: request.id, title: request.title });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('AGENT_UPDATE', {
        targetAgentId: request.id,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(
          permissionResult.message || 'No permission to update this agent',
        );
      }

      // Build query conditions
      const whereConditions = [eq(agents.id, request.id)];
      const permissionWhere = this.buildPermissionWhere(agents, permissionResult.condition);
      if (permissionWhere) whereConditions.push(permissionWhere);
      const rowWhere = and(...whereConditions)!;

      // Check if the Agent exists. Read unlocked — the row lock only needs to
      // guard the write below (see `writeAgentConfigWithShareReset`), mirroring
      // `AgentModel.updateConfig`'s own unlocked-read/locked-write split.
      const existingAgent = await this.db.query.agents.findFirst({
        where: rowWhere,
      });

      if (!existingAgent) {
        throw this.createBusinessError(`Agent ID "${request.id}" not found`);
      }

      // Only update fields actually provided in the request to avoid overwriting existing values with undefined
      const updateData: Record<string, unknown> = { updatedAt: new Date() };

      if (request.agencyConfig !== undefined) {
        // Merged, not replaced. The request schema exposes only the graph
        // slice of `agencyConfig`, while the column also carries the member
        // permission policies, device bindings and execution settings
        // written elsewhere — so replacing the object would silently delete
        // every one of them, including the topic-share policy that keeps a
        // restricted agent's conversations from being published.
        //
        // An explicit `null` still clears the column, as it always did. What
        // survives that clear depends on authority: this endpoint authorizes
        // on `AGENT_UPDATE`, which workspace Admins hold for *everyone's*
        // agents, while the policy keys are the agent creator's and the
        // workspace primary owner's alone — the same gate `updateAgentConfig`
        // applies. Without this an Admin could reset a `restricted` policy by
        // clearing a column whose policy keys the schema cannot even express.
        const canWritePolicies =
          existingAgent.userId === this.userId ||
          (!!existingAgent.workspaceId &&
            (await isWorkspacePrimaryOwner({
              db: this.db,
              userId: this.userId,
              workspaceId: existingAgent.workspaceId,
            })));

        updateData.agencyConfig =
          request.agencyConfig === null
            ? resolveClearedAgencyConfig(existingAgent.agencyConfig, canWritePolicies)
            : mergeJsonPatch(existingAgent.agencyConfig, request.agencyConfig);
      }
      if (request.avatar !== undefined) updateData.avatar = request.avatar ?? null;
      if (request.chatConfig !== undefined) {
        // Same reason as `agencyConfig` above: the schema exposes 13 of
        // `LobeAgentChatConfig`'s fields, so replacing the object would drop
        // the two dozen a caller has no way to send back.
        updateData.chatConfig =
          request.chatConfig === null
            ? null
            : mergeJsonPatch(existingAgent.chatConfig, request.chatConfig);
      }
      if (request.description !== undefined) updateData.description = request.description ?? null;
      if (request.model !== undefined) updateData.model = request.model ?? null;
      if (request.provider !== undefined) updateData.provider = request.provider ?? null;
      if (request.systemRole !== undefined) updateData.systemRole = request.systemRole ?? null;
      if (request.title !== undefined) updateData.title = request.title;

      // Merge params instead of fully overwriting
      if (request.params !== undefined) {
        updateData.params = mergeJsonPatch(existingAgent.params, request.params);
      }

      // Write the config and reset any non-private share back to `private` if
      // this write turns the agent heterogeneous, all under a single row lock.
      // This endpoint used to write `agents` directly with `tx.update(agents)`,
      // bypassing `AgentModel.updateConfig` (and its share-reset invariant)
      // entirely, so `PATCH /api/v1/agents/:id` could switch a published
      // homogeneous agent to Codex/Claude Code while its share stayed `link`.
      // See `writeAgentConfigWithShareReset`'s JSDoc.
      const updatedAgent = await writeAgentConfigWithShareReset(this.db, {
        agentId: request.id,
        onShareReset: (agentId) =>
          options?.onShareReset?.({ agentId, ownerId: existingAgent.userId }),
        // `updateData` may legitimately carry an explicit `null` for either
        // field (a caller-requested clear), so branch on key presence rather
        // than `??` — a `??` fallback would silently undo an intentional
        // clear by resurrecting the pre-write value.
        resultingConfig: {
          agencyConfig: Object.hasOwn(updateData, 'agencyConfig')
            ? (updateData.agencyConfig as typeof existingAgent.agencyConfig)
            : existingAgent.agencyConfig,
          model: Object.hasOwn(updateData, 'model')
            ? (updateData.model as string | null)
            : existingAgent.model,
        },
        touchesHeterogeneityFields:
          request.agencyConfig !== undefined || request.model !== undefined,
        updateData,
        where: rowWhere,
      });

      if (!updatedAgent) {
        throw this.createBusinessError(`Agent ID "${request.id}" not found`);
      }

      this.log('info', 'agent updated successfully', {
        id: updatedAgent.id,
        slug: updatedAgent.slug,
      });
      return projectPublicAgent(updatedAgent);
    } catch (error) {
      this.handleServiceError(error, 'update agent');
    }
  }

  /**
   * Delete an agent
   * @param request Delete request parameters
   * @param options `onShareRunsInterrupted` — see `AgentModel.delete`'s
   * JSDoc: `packages/openapi` cannot reach `AiAgentService` (apps/server) to
   * interrupt in-flight Agent Share visitor runs itself, so the caller that
   * CAN (`AgentController.deleteAgent`) must pass a callback that stashes the
   * post-commit snapshot somewhere the mounting route file can pick up — see
   * `AGENT_SHARE_DELETE_SIGNAL_HEADER`.
   */
  async deleteAgent(
    request: AgentDeleteRequest,
    options?: { onShareRunsInterrupted?: (activeShareRuns: ActiveShareRun[]) => void },
  ): ServiceResult<void> {
    this.log('info', 'delete agent', {
      agentId: request.agentId,
      migrateSessionTo: request.migrateSessionTo,
    });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('AGENT_DELETE', {
        targetAgentId: request.agentId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(
          permissionResult.message || 'No permission to delete this agent',
        );
      }

      // Snapshotted inside the transaction below (both branches), BEFORE
      // whichever delete cascades the visitor topic rows away, and reported
      // to `options.onShareRunsInterrupted` only after the transaction has
      // committed — a runtime interrupt is a side effect that must never
      // fire on a rollback.
      let activeShareRuns: ActiveShareRun[] = [];

      await this.db.transaction(async (tx) => {
        // Re-read inside the lock-holding transaction so an OpenAPI delete has
        // the same owner-scoped-state invariant as the lambda and tool paths.
        const targetAgent = await tx.query.agents.findFirst({
          where: and(eq(agents.id, request.agentId), this.buildWorkspaceWhere(agents)),
        });
        if (!targetAgent) {
          throw this.createBusinessError(`Agent ID ${request.agentId} not found`);
        }

        await assertAgentDeletionAllowed({
          agentId: request.agentId,
          executor: tx,
          userId: this.userId,
        });

        if (request.migrateSessionTo) {
          // Validate the migration target against the same transaction snapshot.
          const migrateTarget = await tx.query.agents.findFirst({
            where: and(eq(agents.id, request.migrateSessionTo), this.buildWorkspaceWhere(agents)),
          });
          if (!migrateTarget) {
            throw this.createBusinessError(
              `Migration target agent ID ${request.migrateSessionTo} not found`,
            );
          }

          await this.migrateAgentSessions(
            request.agentId,
            request.migrateSessionTo,
            tx as unknown as LobeChatDatabase,
          );
          this.log('info', 'session migration completed', {
            from: request.agentId,
            to: request.migrateSessionTo,
          });

          // Agent sharing is personal-only (`workspaceId` unset), and this raw
          // delete bypasses `AgentModel.delete`'s own snapshot — take it here,
          // before the delete below cascades the topic rows away.
          if (!this.workspaceId && this.userId) {
            activeShareRuns = await new TopicModel(
              tx as unknown as LobeChatDatabase,
              this.userId,
            ).findActiveVisitorRunTopics(request.agentId);
          }

          // Sessions already moved; delete only the source agent while the
          // durable-state guard remains locked in the outer transaction.
          await tx
            .delete(agents)
            .where(and(eq(agents.id, request.agentId), this.buildWorkspaceWhere(agents)));
          return;
        }

        await new AgentModel(tx as unknown as LobeChatDatabase, this.userId, this.workspaceId, {
          onShareRunsInterrupted: (runs) => {
            activeShareRuns = runs;
          },
        }).delete(request.agentId);
      });

      if (activeShareRuns.length > 0) {
        options?.onShareRunsInterrupted?.(activeShareRuns);
      }

      this.log('info', 'agent deleted successfully', { agentId: request.agentId });
    } catch (error) {
      this.handleServiceError(error, 'delete agent');
    }
  }

  /**
   * Get Agent details by ID
   * @param agentId Agent ID
   * @returns Agent details
   */
  async getAgentById(agentId: string): ServiceResult<AgentDetailResponse | null> {
    this.log('info', 'get agent details by ID', { agentId });

    try {
      // Permission validation
      const permissionResult = await this.resolveOperationPermission('AGENT_READ', {
        targetAgentId: agentId,
      });

      if (!permissionResult.isPermitted) {
        throw this.createAuthorizationError(
          permissionResult.message || 'No permission to access this agent',
        );
      }

      if (!this.userId) {
        throw this.createAuthError('Not logged in, cannot get agent details');
      }

      // Reuse AgentModel methods to get the full Agent configuration
      const agentModel = new AgentModel(this.db, this.userId, this.workspaceId);
      const agent = await agentModel.getAgentConfigById(agentId);

      if (!agent || !agent.id) {
        this.log('warn', 'agent not found', { agentId });
        return null;
      }

      return {
        ...projectPublicAgent(agent),
        files: agent.files
          .filter((file) => file.id)
          .map((file) => ({
            ...projectPublicFile(file as FileItem),
            enabled: file.enabled,
          })),
        knowledgeBases: agent.knowledgeBases
          .filter((knowledgeBase) => knowledgeBase.id)
          .map((knowledgeBase) => ({
            ...projectPublicKnowledgeBase(knowledgeBase as KnowledgeBaseItem),
            enabled: knowledgeBase.enabled,
          })),
      };
    } catch (error) {
      this.handleServiceError(error, 'get agent details');
    }
  }

  /**
   * Migrate an Agent's sessions to another Agent
   * @param fromAgentId Source Agent ID
   * @param toAgentId Target Agent ID
   * @private
   */
  private async migrateAgentSessions(
    fromAgentId: string,
    toAgentId: string,
    db: LobeChatDatabase = this.db,
  ): Promise<void> {
    this.log('info', 'start migrating sessions', { fromAgentId, toAgentId });

    try {
      await db.transaction(async (tx) => {
        // Get all sessionIds associated with the source Agent
        const links = await tx
          .select({ sessionId: agentsToSessions.sessionId })
          .from(agentsToSessions)
          .where(
            and(
              eq(agentsToSessions.agentId, fromAgentId),
              this.buildWorkspaceWhere(agentsToSessions),
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
              this.buildWorkspaceWhere(agentsToSessions),
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
              ...this.buildWorkspacePayload({}),
            })),
          );
        }

        this.log('info', 'session migration completed', { count: newSessionIds.length });
      });

      this.log('info', 'session migration succeeded', { fromAgentId, toAgentId });
    } catch (error) {
      this.handleServiceError(error, 'session migration');
    }
  }
}
