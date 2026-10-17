import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { ChatGroupModel } from '@/database/models/chatGroup';
import { ResourcePermissionModel } from '@/database/models/resourcePermission';
import { TaskModel } from '@/database/models/task';
import type { ResourceAccessLevel } from '@/database/schemas';
import { DEFAULT_RESOURCE_ACCESS_LEVELS, RESOURCE_ACCESS_LEVELS_BY_TYPE } from '@/database/schemas';
import {
  assertCanPerformResourceAction,
  buildResourcePermissionState,
} from '@/server/services/resourcePermission';

import { agentProcedure } from './procedures';

export const visibilityProcedures = {
  /**
   * Publish a private agent into the workspace. Only the creator of a
   * still-private agent can run this; the underlying SQL enforces both rules.
   * The inverse transition (public → private) goes through
   * `setAgentVisibility`, which is gated to the creator only.
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
        const permissionModel = new ResourcePermissionModel(ctx.serverDB, ctx.workspaceId);
        // An explicit request wins; otherwise keep whatever the creator already
        // chose on the Permission page while the agent was still private —
        // rewriting the default here would silently discard that decision.
        const accessLevel =
          input.accessLevel ??
          (await permissionModel.getAccessLevel('agent', input.id)) ??
          DEFAULT_RESOURCE_ACCESS_LEVELS.agent;
        await permissionModel.setAccessLevel('agent', input.id, accessLevel, ctx.userId);
      }
      return result;
    }),
  /**
   * Bidirectional visibility switch. Rules:
   * - builtin agents (LobeAI etc., identified by slug) can never change
   *   visibility — the workspace copy must stay shared;
   * - only the agent's creator may pull a published agent back to private
   *: a workspace owner demoting another member's agent would
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
      // reads drop a non-visible member per viewer instead.
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

      let accessLevel: ResourceAccessLevel;
      if (input.visibility === 'private') {
        accessLevel = 'edit';
        await permissionModel.removeAll('agent', input.id);
      } else {
        // Same rule as `publishAgentToWorkspace`: promotion keeps a level the
        // creator already set while private instead of resetting to the default.
        accessLevel =
          input.accessLevel ??
          (await permissionModel.getAccessLevel('agent', input.id)) ??
          DEFAULT_RESOURCE_ACCESS_LEVELS.agent;
        await permissionModel.setAccessLevel('agent', input.id, accessLevel, ctx.userId);
      }

      return buildResourcePermissionState({
        accessLevel,
        canManage: true,
        creatorId: meta.userId,
        visibility: input.visibility,
      });
    }),
};
