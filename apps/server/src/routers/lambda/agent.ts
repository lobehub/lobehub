import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { DEFAULT_AGENT_CONFIG, INBOX_SESSION_ID } from '@lobechat/const';
import { CreateAgentSchema, type KnowledgeItem } from '@lobechat/types';
import { KnowledgeType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { SessionModel } from '@/database/models/session';
import { TaskModel } from '@/database/models/task';
import { UserModel } from '@/database/models/user';
import { DEFAULT_RESOURCE_ACCESS_LEVELS, RESOURCE_ACCESS_LEVELS_BY_TYPE } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentService } from '@/server/services/agent';
import { EditLockService } from '@/server/services/editLock';
import { publishResourceEvent } from '@/server/services/resourceEvents';
import {
  assertCanEditResource,
  assertCanPerformResourceAction,
  buildResourcePermissionState,
} from '@/server/services/resourcePermission';
import {
  hasWorkspaceScopedPermission,
  isWorkspacePrimaryOwner,
} from '@/server/services/workspacePermission';
import { TransferErrorCode } from '@/types/transferError';

import { isWorkspaceNonOwner } from './_helpers/assertWorkspaceRowManageable';
import { getResourceConfigAccess, redactAgentConfig } from './_helpers/resourceConfigGuard';

const protectAgentConfig = async <T extends Record<string, any>>(
  ctx: {
    serverDB: Parameters<typeof getResourceConfigAccess>[0]['db'];
    userId: string;
    workspaceId?: string | null;
    workspacePermissionCodes?: string[];
  },
  agentId: string,
  config: T | null | undefined,
): Promise<T | null> => {
  if (!config) return null;

  const access = await getResourceConfigAccess(
    {
      db: ctx.serverDB,
      grantedPermissions: ctx.workspacePermissionCodes,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    },
    'agent',
    agentId,
  );

  if (access === 'none') return null;
  return access === 'profile' ? redactAgentConfig(config) : config;
};

const agentProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId, wsId),
      agentService: new AgentService(ctx.serverDB, ctx.userId, wsId),
      chatGroupModel: new ChatGroupModel(ctx.serverDB, ctx.userId, wsId),
      editLockService: new EditLockService(ctx.userId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId, wsId),
      knowledgeBaseModel: new KnowledgeBaseModel(ctx.serverDB, ctx.userId, wsId),
      sessionModel: new SessionModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export const agentRouter = router({
  /**
   * Check if an agent with the given marketIdentifier already exists
   */
  checkByMarketIdentifier: agentProcedure
    .input(
      z.object({
        marketIdentifier: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentModel.checkByMarketIdentifier(input.marketIdentifier);
    }),

  /**
   * Count non-virtual agents with optional keyword filter, matching the
   * conditions of queryAgents. Lets paginated callers report real totals.
   */
  countAgents: agentProcedure
    .input(
      z
        .object({
          endDate: z.string().optional(),
          keyword: z.string().optional(),
          range: z.tuple([z.string(), z.string()]).optional(),
          startDate: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentModel.countAgents(input);
    }),

  /**
   * Create a new agent with session
   * Returns the created agent ID and session ID
   */
  createAgent: agentProcedure
    .use(withScopedPermission('agent:create'))
    .input(
      z.object({
        config: CreateAgentSchema.optional(),
        groupId: z.string().optional(),
        visibility: z.enum(['private', 'public']).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const agent = await ctx.agentModel.create({
        ...input.config,
        // The DB-layer AgentItem (packages/database/src/schemas/agent.ts) is
        // intentionally still typed `plugins?: string[]` — the JSONB column
        // itself isn't widened, only the domain-level `@lobechat/types`
        // shapes. Bridges the tri-state object shape through.
        plugins: input.config?.plugins as unknown as string[] | undefined,
        sessionGroupId: input.groupId,
        // Router-level `visibility` wins over any nested config value so the
        // sidebar's "Create in Private" entry can't be overridden by a stale
        // default config.
        ...(input.visibility ? { visibility: input.visibility } : {}),
      });

      if (ctx.workspaceId && agent.visibility !== 'private') {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).setAccessLevel(
          'agent',
          agent.id,
          DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
          ctx.userId,
        );
      }

      return { agentId: agent.id };
    }),

  /**
   * Publish a private agent into the workspace. Only the creator of a
   * still-private agent can run this; the underlying SQL enforces both rules.
   * The inverse transition (public → private) goes through
   * `setAgentVisibility`, which is gated to the creator only (LOBE-11760).
   */
  publishAgentToWorkspace: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        accessLevel: z.enum(RESOURCE_ACCESS_LEVELS_BY_TYPE.agent).optional(),
        id: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.agentModel.publishToWorkspace(input.id);
      if (ctx.workspaceId) {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).setAccessLevel(
          'agent',
          input.id,
          input.accessLevel ?? DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
          ctx.userId,
        );
      }
      return result;
    }),

  /**
   * Bidirectional visibility switch (LOBE-11551). Rules:
   * - builtin agents (LobeAI etc., identified by slug) can never change
   *   visibility — the workspace copy must stay shared;
   * - only the agent's creator may pull a published agent back to private
   *   (LOBE-11760): a workspace owner demoting another member's agent would
   *   effectively appropriate it, so everyone else gets FORBIDDEN. The UI
   *   hides the entry for them, this is the server-side backstop.
   */
  setAgentVisibility: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        accessLevel: z.enum(RESOURCE_ACCESS_LEVELS_BY_TYPE.agent).optional(),
        id: z.string(),
        visibility: z.enum(['private', 'public']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const meta = await ctx.agentModel.getAgentVisibilityMeta(input.id);
      if (!meta) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });

      if (meta.slug && Object.values(BUILTIN_AGENT_SLUGS).includes(meta.slug as any)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Builtin agents cannot change visibility',
        });
      }

      if (!ctx.workspaceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Agent visibility only applies inside a workspace',
        });
      }
      const permissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
      const permissionMeta = { ...meta, workspaceId: ctx.workspaceId };
      const blockingTasksPromise =
        input.visibility === 'private' && meta.visibility !== input.visibility
          ? new TaskModel(
              ctx.serverDB,
              ctx.userId,
              ctx.workspaceId,
            ).countTasksBlockingAgentDemotion(input.id, meta.userId)
          : Promise.resolve(0);
      const [, blockingTasks] = await Promise.all([
        assertCanPerformResourceAction({
          action: 'changeVisibility',
          db: ctx.serverDB,
          grantedPermissions: (ctx as { workspacePermissionCodes?: string[] })
            .workspacePermissionCodes,
          meta: permissionMeta,
          resourceId: input.id,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }),
        blockingTasksPromise,
      ]);

      if (meta.visibility === input.visibility) {
        const accessLevel =
          input.visibility === 'public'
            ? (input.accessLevel ??
              (await permissionModel.getEffectiveAccessLevel('agent', input.id)))
            : 'edit';
        if (input.visibility === 'public' && input.accessLevel) {
          await permissionModel.setAccessLevel('agent', input.id, input.accessLevel, ctx.userId);
        }
        return buildResourcePermissionState({
          accessLevel,
          canManage: true,
          creatorId: meta.userId,
          visibility: input.visibility,
        });
      }

      // Demoting an agent must not strand tasks that depend on it: public
      // tasks would violate the `assertAgentVisibilityCompat` invariant
      // (members keep seeing the task but can no longer see or run the
      // assignee), and other members' tasks — private ones included — would
      // fail future runs/updates because their creators can no longer
      // resolve the agent. Reject early — reassign or demote those tasks
      // first.
      if (blockingTasks > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Cannot make this agent private while workspace tasks still depend on it. Reassign those tasks or make them private first.',
        });
      }

      // Same source-level guard for group chats, but only for the supervisor
      // role: a private supervisor is unresolvable for every other viewer and
      // bricks the whole group. Regular members are not blocked — roster
      // reads drop a non-visible member per viewer instead (LOBE-11772).
      if (input.visibility === 'private') {
        const chatGroupModel = new ChatGroupModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
        const blockingGroups = await chatGroupModel.countGroupsBlockingAgentDemotion(
          input.id,
          meta.userId,
        );
        if (blockingGroups > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Cannot make this agent private while it supervises workspace group chats. Remove it as supervisor first.',
          });
        }
      }

      const updated = await ctx.agentModel.setVisibility(input.id, input.visibility);
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });

      const accessLevel =
        input.visibility === 'private'
          ? 'edit'
          : (input.accessLevel ?? DEFAULT_RESOURCE_ACCESS_LEVELS.agent);
      if (input.visibility === 'private') {
        await permissionModel.removeAll('agent', input.id);
      } else {
        await permissionModel.setAccessLevel(
          'agent',
          input.id,
          input.accessLevel ?? DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
          ctx.userId,
        );
      }

      return buildResourcePermissionState({
        accessLevel,
        canManage: true,
        creatorId: meta.userId,
        visibility: input.visibility,
      });
    }),

  createAgentFiles: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        fileIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      return ctx.agentModel.createAgentFiles(input.agentId, input.fileIds, input.enabled);
    }),

  createAgentKnowledgeBase: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        knowledgeBaseId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      return ctx.agentModel.createAgentKnowledgeBase(
        input.agentId,
        input.knowledgeBaseId,
        input.enabled,
      );
    }),

  /**
   * Create an agent without session.
   * Used for Group Agent Builder to create agents for groups.
   * Returns only the agent ID.
   */
  createAgentOnly: agentProcedure
    .use(withScopedPermission('agent:create'))
    .input(
      z.object({
        config: z.object({}).passthrough().optional(),
        groupId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Mutating the group's roster is a group edit — same ACL as
      // `agentGroup.addAgentsToGroup`. Check before creating the agent so a
      // denied call doesn't leave an orphan agent behind.
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.groupId,
          resourceType: 'agentGroup',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }

      // Create the agent entity only (no session)
      const agent = await ctx.agentModel.create(input.config ?? {});

      // Add the agent to the group
      await ctx.chatGroupModel.addAgentToGroup(input.groupId, agent.id);

      if (ctx.workspaceId && agent.visibility !== 'private') {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).setAccessLevel(
          'agent',
          agent.id,
          DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
          ctx.userId,
        );
      }

      return { agentId: agent.id };
    }),

  deleteAgentFile: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        fileId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      return ctx.agentModel.deleteAgentFile(input.agentId, input.fileId);
    }),

  deleteAgentKnowledgeBase: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        knowledgeBaseId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      return ctx.agentModel.deleteAgentKnowledgeBase(input.agentId, input.knowledgeBaseId);
    }),

  /**
   * Duplicate an agent and its associated session.
   * Returns the new agent ID and session ID.
   */
  duplicateAgent: agentProcedure
    .use(withScopedPermission('agent:fork'))
    .input(
      z.object({
        agentId: z.string(),
        newTitle: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Forking creates a caller-owned Agent and is governed by `agent:fork`,
      // independently of the source Agent's collaborative-edit permission.
      const result = await ctx.agentModel.duplicate(input.agentId, input.newTitle);
      if (ctx.workspaceId && result) {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).setAccessLevel(
          'agent',
          result.agentId,
          DEFAULT_RESOURCE_ACCESS_LEVELS.agent,
          ctx.userId,
        );
      }
      return result;
    }),

  /**
   * Get an agent by forkedFromIdentifier stored in params
   * @returns agent id if exists, null otherwise
   */
  getAgentByForkedFromIdentifier: agentProcedure
    .input(
      z.object({
        forkedFromIdentifier: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentModel.getAgentByForkedFromIdentifier(input.forkedFromIdentifier);
    }),

  /**
   * Get an agent by marketIdentifier
   * @returns agent id if exists, null otherwise
   */
  getAgentByMarketIdentifier: agentProcedure
    .input(
      z.object({
        marketIdentifier: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentModel.getAgentByMarketIdentifier(input.marketIdentifier);
    }),

  getAgentConfig: agentProcedure
    .input(
      z.object({
        sessionId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (input.sessionId === INBOX_SESSION_ID) {
        const item = await ctx.sessionModel.findByIdOrSlug(INBOX_SESSION_ID);
        // if there is no session for user, create one
        if (!item) {
          // if there is no user, return default config
          const user = await UserModel.findById(ctx.serverDB, ctx.userId);
          if (!user) return DEFAULT_AGENT_CONFIG;

          const res = await ctx.agentService.createInbox();
          console.info('create inbox session', res);
        }
      }

      const session = await ctx.sessionModel.findByIdOrSlug(input.sessionId);

      if (!session) throw new Error(`Session [${input.sessionId}] not found`);
      const sessionId = session.id;

      const config = await ctx.agentModel.findBySessionId(sessionId);
      return config?.id ? protectAgentConfig(ctx, config.id, config) : config;
    }),

  getAgentConfigById: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const config = await ctx.agentService.getAgentConfigById(input.agentId);
      return protectAgentConfig(ctx, input.agentId, config);
    }),

  /**
   * Get a builtin agent by slug, creating it if it doesn't exist.
   * This is a generic interface for all builtin agents (page-copilot, inbox, etc.)
   */
  getBuiltinAgent: agentProcedure
    .input(
      z.object({
        slug: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const config = await ctx.agentService.getBuiltinAgent(input.slug);
      return config?.id ? protectAgentConfig(ctx, config.id, config) : config;
    }),

  getKnowledgeBasesAndFiles: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        visibility: z.enum(['private', 'public']).optional(),
      }),
    )
    .query(async ({ ctx, input }): Promise<KnowledgeItem[]> => {
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: input.agentId,
        resourceType: 'agent',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      // Look up the target agent's visibility so we can (a) apply the
      // "public agent cannot reach caller's private rows" defensive filter
      // in the model layer, and (b) hard-force `visibility='public'` when
      // the agent is public — the client tab is a UX aid, not a gate.
      const agentVisibility = await ctx.agentModel.getAgentVisibility(input.agentId);
      const effectiveVisibility =
        agentVisibility === 'public' ? ('public' as const) : input.visibility;

      const knowledgeBases = await ctx.knowledgeBaseModel.query({
        callerAgentVisibility: agentVisibility,
        visibility: effectiveVisibility,
      });

      const files = await ctx.fileModel.query({
        callerAgentVisibility: agentVisibility,
        showFilesInKnowledgeBase: false,
        visibility: effectiveVisibility,
      });

      const knowledge = await ctx.agentModel.getAgentAssignedKnowledge(input.agentId);

      return [
        ...files
          // Filter out all images
          .filter((file) => !file.fileType.startsWith('image'))
          .map((file) => ({
            enabled: knowledge.files.some((item) => item.id === file.id),
            fileType: file.fileType,
            id: file.id,
            name: file.name,
            ownerUserId: file.userId,
            type: KnowledgeType.File,
            visibility: file.visibility as 'private' | 'public',
          })),
        ...knowledgeBases.map((knowledgeBase) => ({
          avatar: knowledgeBase.avatar,
          description: knowledgeBase.description,
          enabled: knowledge.knowledgeBases.some((item) => item.id === knowledgeBase.id),
          id: knowledgeBase.id,
          name: knowledgeBase.name,
          ownerUserId: knowledgeBase.userId,
          type: KnowledgeType.KnowledgeBase,
          visibility: knowledgeBase.visibility,
        })),
      ];
    }),

  /**
   * Query non-virtual agents with optional keyword filter.
   * Returns agents with minimal info (id, title, description, avatar, backgroundColor).
   * Used by AddGroupMemberModal and group-management tool to search/select agents.
   */
  queryAgents: agentProcedure
    .input(
      z
        .object({
          keyword: z.string().optional(),
          limit: z.number().max(100).optional(),
          offset: z.number().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      return ctx.agentModel.queryAgents(input);
    }),

  rankAgents: agentProcedure.input(z.number().max(50).optional()).query(async ({ ctx, input }) => {
    return ctx.agentModel.rank(input);
  }),

  /**
   * Remove an agent and its associated session
   */
  removeAgent: agentProcedure
    .use(withScopedPermission('agent:delete'))
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'delete',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        // Same rule as transfer: the delete cascade erases every linked
        // session/topic/message, so a non-owner member must not take teammates'
        // conversations down with their own agent.
        if (
          isWorkspaceNonOwner(ctx) &&
          (await ctx.agentModel.transferHasForeignRows(input.agentId))
        ) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.OwnerOnly } },
            code: 'FORBIDDEN',
            message: "Only workspace owners can delete an agent carrying others' conversations",
          });
        }
      }
      const result = await ctx.agentModel.delete(input.agentId);
      if (ctx.workspaceId) {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).removeAll(
          'agent',
          input.agentId,
        );
      }
      return result;
    }),

  toggleFile: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        fileId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      return ctx.agentModel.toggleFile(input.agentId, input.fileId, input.enabled);
    }),

  toggleKnowledgeBase: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        enabled: z.boolean().optional(),
        knowledgeBaseId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'edit',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }
      return ctx.agentModel.toggleKnowledgeBase(
        input.agentId,
        input.knowledgeBaseId,
        input.enabled,
      );
    }),

  transferAgent: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        targetAccessLevel: z.enum(RESOURCE_ACCESS_LEVELS_BY_TYPE.agent).optional(),
        /** @deprecated Compatibility for released clients. */
        targetGeneralAccess: z.enum(['editor', 'viewer']).optional(),
        targetVisibility: z.enum(['private', 'public']).optional(),
        targetWorkspaceId: z.string().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // 1. Fetch the agent to check ownership
      const agent = await ctx.agentModel.getAgentConfigById(input.agentId);
      if (!agent) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'Agent not found',
        });
      }

      // 2. Transferring ownership/scope is always creator-only.
      if (ctx.workspaceId) {
        await assertCanPerformResourceAction({
          action: 'transfer',
          db: ctx.serverDB,
          resourceId: input.agentId,
          resourceType: 'agent',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      }

      // 3. Validate target workspace access (user must be member+)
      if (input.targetWorkspaceId) {
        const canWriteTarget = await hasWorkspaceScopedPermission({
          action: 'AGENT_CREATE',
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: input.targetWorkspaceId,
        });

        if (!canWriteTarget) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
            code: 'FORBIDDEN',
            message: 'No write access to target workspace',
          });
        }
      }

      // 4. Cannot transfer to the same workspace
      if (input.targetWorkspaceId === ctx.workspaceId) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.SameWorkspace } },
          code: 'BAD_REQUEST',
          message: 'Cannot transfer agent to the same workspace',
        });
      }

      // 5. The transfer rehomes every linked topic/message/thread/task — only
      //    the primary owner may move teammates' conversations along with an
      //    agent; co-admins and members may not.
      if (
        ctx.workspaceId &&
        !(await isWorkspacePrimaryOwner({
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        })) &&
        (await ctx.agentModel.transferHasForeignRows(input.agentId))
      ) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.OwnerOnly } },
          code: 'FORBIDDEN',
          message: "Only the workspace owner can transfer an agent carrying others' conversations",
        });
      }

      const result = await ctx.agentModel.transferAgent(
        input.agentId,
        input.targetWorkspaceId,
        ctx.userId,
        input.targetVisibility,
      );

      if (ctx.workspaceId) {
        await new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId).removeAll(
          'agent',
          input.agentId,
        );
      }
      if (input.targetWorkspaceId && input.targetVisibility === 'public') {
        const targetAccessLevel =
          input.targetAccessLevel ??
          (input.targetGeneralAccess === 'editor' ? 'edit' : DEFAULT_RESOURCE_ACCESS_LEVELS.agent);
        await new ResourcePermissionModel(ctx.serverDB, input.targetWorkspaceId).setAccessLevel(
          'agent',
          input.agentId,
          targetAccessLevel,
          ctx.userId,
        );
      }

      return result;
    }),

  /**
   * Batch variant of `transferAgent`: one request + one DB transaction for all
   * selected agents, so a multi-select "Move Agent" is no longer N serial
   * round-trips (each with its own permission checks and large-table updates).
   */
  transferAgents: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentIds: z.array(z.string()).min(1).max(100),
        targetAccessLevel: z.enum(RESOURCE_ACCESS_LEVELS_BY_TYPE.agent).optional(),
        targetVisibility: z.enum(['private', 'public']).optional(),
        targetWorkspaceId: z.string().nullable(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const agentIds = [...new Set(input.agentIds)];

      // 1. All agents must exist in the current scope
      const existences = await Promise.all(
        agentIds.map((agentId) => ctx.agentModel.existsById(agentId)),
      );
      if (existences.some((exists) => !exists)) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'Agent not found',
        });
      }

      // 2. Transferring ownership/scope is always creator-only.
      if (ctx.workspaceId) {
        await Promise.all(
          agentIds.map((agentId) =>
            assertCanPerformResourceAction({
              action: 'transfer',
              db: ctx.serverDB,
              resourceId: agentId,
              resourceType: 'agent',
              userId: ctx.userId,
              workspaceId: ctx.workspaceId!,
            }),
          ),
        );
      }

      // 3. Validate target workspace access once (user must be member+)
      if (input.targetWorkspaceId) {
        const canWriteTarget = await hasWorkspaceScopedPermission({
          action: 'AGENT_CREATE',
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: input.targetWorkspaceId,
        });

        if (!canWriteTarget) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
            code: 'FORBIDDEN',
            message: 'No write access to target workspace',
          });
        }
      }

      // 4. Cannot transfer to the same workspace
      if (input.targetWorkspaceId === ctx.workspaceId) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.SameWorkspace } },
          code: 'BAD_REQUEST',
          message: 'Cannot transfer agent to the same workspace',
        });
      }

      // 5. The transfer rehomes every linked topic/message/thread/task — only
      //    the primary owner may move teammates' conversations along with
      //    agents. One batched check for the whole selection.
      if (
        ctx.workspaceId &&
        !(await isWorkspacePrimaryOwner({
          db: ctx.serverDB,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        })) &&
        (await ctx.agentModel.transferHasForeignRows(agentIds))
      ) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.OwnerOnly } },
          code: 'FORBIDDEN',
          message: "Only the workspace owner can transfer an agent carrying others' conversations",
        });
      }

      const results = await ctx.agentModel.transferAgents(
        agentIds,
        input.targetWorkspaceId,
        ctx.userId,
        input.targetVisibility,
      );

      if (ctx.workspaceId) {
        const sourcePermissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
        await Promise.all(
          agentIds.map((agentId) => sourcePermissionModel.removeAll('agent', agentId)),
        );
      }
      if (input.targetWorkspaceId && input.targetVisibility === 'public') {
        const targetAccessLevel = input.targetAccessLevel ?? DEFAULT_RESOURCE_ACCESS_LEVELS.agent;
        const targetPermissionModel = new ResourcePermissionModel(
          ctx.serverDB,
          input.targetWorkspaceId,
        );
        await Promise.all(
          agentIds.map((agentId) =>
            targetPermissionModel.setAccessLevel('agent', agentId, targetAccessLevel, ctx.userId),
          ),
        );
      }

      return results;
    }),

  updateAgentConfig: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        value: z.object({}).passthrough().partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // General-access write guard: only `edit` permits collaborative updates.
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: input.agentId,
        resourceType: 'agent',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      // Collaborative edit lock: reject writes to a workspace agent another
      // member is actively editing. Inert until a client acquires the lock.
      if (ctx.workspaceId) {
        const blockedBy = await ctx.editLockService.getBlockingHolder('agent', input.agentId);
        if (blockedBy) {
          throw new TRPCError({
            cause: { data: { code: 'DocumentLocked' } },
            code: 'CONFLICT',
            message: 'Agent is being edited by another user',
          });
        }
      }

      // Use AgentService to update and return the updated agent data
      return ctx.agentService.updateAgentConfig(input.agentId, input.value);
    }),

  /**
   * Pin or unpin an agent
   */
  updateAgentPinned: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        id: z.string(),
        pinned: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.agentModel.update(input.id, { pinned: input.pinned });
    }),

  acquireAgentLock: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) return { expiresAt: null, holderId: null, lockedByOther: false };
      const prev = await ctx.editLockService.getActiveHolder('agent', input.agentId);
      const result = await ctx.editLockService.acquire('agent', input.agentId);
      if ((result.holderId ?? null) !== (prev ?? null)) {
        void publishResourceEvent(
          { id: input.agentId, type: 'agent' },
          { actorId: ctx.userId, data: { holderId: result.holderId }, type: 'lock.changed' },
        );
      }
      return result;
    }),

  getAgentLock: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(z.object({ agentId: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.workspaceId) return { expiresAt: null, holderId: null, lockedByOther: false };
      const holder = await ctx.editLockService.getActiveHolder('agent', input.agentId);
      return {
        expiresAt: null,
        holderId: holder ?? null,
        lockedByOther: Boolean(holder) && holder !== ctx.userId,
      };
    }),

  releaseAgentLock: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(z.object({ agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) return;
      // Only broadcast "unlocked" when we actually released our own lock — if the
      // lease expired and another member took over, the lock is still held.
      const released = await ctx.editLockService.release('agent', input.agentId);
      if (!released) return;
      void publishResourceEvent(
        { id: input.agentId, type: 'agent' },
        { actorId: ctx.userId, data: { holderId: null }, type: 'lock.changed' },
      );
    }),
});
