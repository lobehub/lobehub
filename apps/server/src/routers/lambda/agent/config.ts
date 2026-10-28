import { DEFAULT_AGENT_CONFIG, INBOX_SESSION_ID } from '@lobechat/const';
import { AGENT_PERMISSION_POLICY_KEYS } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { UserModel } from '@/database/models/user';
import { router } from '@/libs/trpc/lambda';
import {
  InboxNotProvisionedError,
  resolveAgentReference,
} from '@/server/services/agent/resolveReference';
import { assertCanEditResource } from '@/server/services/resourcePermission';
import { isWorkspacePrimaryOwner } from '@/server/services/workspacePermission';

import { getResourceConfigAccess, redactAgentConfig } from '../_helpers/resourceConfigGuard';
import { agentProcedure } from './procedures';

const getAgentPermissionPolicyPatch = (value: Record<string, unknown>) => {
  const agencyConfig = value.agencyConfig;

  return isRecord(agencyConfig) && AGENT_PERMISSION_POLICY_KEYS.some((key) => key in agencyConfig)
    ? agencyConfig
    : null;
};

const stripAgentPermissionPolicies = (value: Record<string, unknown>) => {
  const policyPatch = getAgentPermissionPolicyPatch(value);
  if (!policyPatch) return value;

  const {
    executionTargetSelectionPolicy: _executionTargetSelectionPolicy,
    modelSelectionPolicy: _modelSelectionPolicy,
    topicSharePolicy: _topicSharePolicy,
    ...safeAgencyConfig
  } = policyPatch;

  return { ...value, agencyConfig: safeAgencyConfig };
};

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

export const configRouter = router({
  getAgentConfig: agentProcedure
    .input(
      z.object({
        sessionId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (input.sessionId === INBOX_SESSION_ID || input.sessionId === 'ssn_inbox') {
        try {
          const resolved = await resolveAgentReference(
            input.sessionId,
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          );
          const config = await ctx.agentService.getAgentConfigById(resolved.agentId);
          return protectAgentConfig(ctx, resolved.agentId, config);
        } catch (error) {
          if (!(error instanceof TRPCError) || !(error.cause instanceof InboxNotProvisionedError))
            throw error;
          const user = await UserModel.findById(ctx.serverDB, ctx.userId);
          if (!user) return DEFAULT_AGENT_CONFIG;
          const config = await ctx.agentService.getBuiltinAgent(INBOX_SESSION_ID);
          return config?.id ? protectAgentConfig(ctx, config.id, config) : config;
        }
      }

      const { agentId } = await resolveAgentReference(
        input.sessionId,
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );
      const config = await ctx.agentService.getAgentConfigById(agentId);
      return protectAgentConfig(ctx, agentId, config);
    }),
  getAgentConfigById: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { agentId } = await resolveAgentReference(
        input.agentId,
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );
      const config = await ctx.agentService.getAgentConfigById(agentId);
      return protectAgentConfig(ctx, agentId, config);
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
  updateAgentConfig: agentProcedure
    .use(withScopedPermission('agent:update'))
    .input(
      z.object({
        agentId: z.string(),
        // Transport-only opt-in; old clients send cached complete device maps.
        replaceWorkingDirDeviceIds: z.array(z.string()).optional(),
        value: z.object({}).passthrough().partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const resolved = await resolveAgentReference(
        input.agentId,
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      );
      const agentId = resolved.agentId;
      // General-access write guard: only `edit` permits collaborative updates.
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: agentId,
        resourceType: 'agent',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      let safeValue = input.value;

      // Model / execution-environment / topic-share policies govern every member.
      // Only the creator or workspace primary owner may write them; other
      // collaborators send a fully merged agencyConfig, so strip the protected
      // keys instead of comparing and later merging stale values over a newer
      // owner update.
      if (ctx.workspaceId) {
        const policyPatch = getAgentPermissionPolicyPatch(input.value);

        if (policyPatch) {
          const canUpdatePolicies =
            (await ctx.agentModel.existsOwnedById(agentId)) ||
            (await isWorkspacePrimaryOwner({
              db: ctx.serverDB,
              userId: ctx.userId,
              workspaceId: ctx.workspaceId,
            }));

          if (!canUpdatePolicies) safeValue = stripAgentPermissionPolicies(input.value);
        }
      }

      // Collaborative edit lock: reject writes to a workspace agent another
      // member is actively editing. Inert until a client acquires the lock.
      if (ctx.workspaceId) {
        const blockedBy = await ctx.editLockService.getBlockingHolder('agent', agentId);
        if (blockedBy) {
          throw new TRPCError({
            cause: { data: { code: 'DocumentLocked' } },
            code: 'CONFLICT',
            message: 'Agent is being edited by another user',
          });
        }
      }

      // Use AgentService to update and return the updated agent data
      return ctx.agentService.updateAgentConfig(
        agentId,
        safeValue,
        input.replaceWorkingDirDeviceIds,
      );
    }),
});
