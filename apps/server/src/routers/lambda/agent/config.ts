import { DEFAULT_AGENT_CONFIG, INBOX_SESSION_ID } from '@lobechat/const';
import { AGENT_PERMISSION_POLICY_KEYS } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { UserModel } from '@/database/models/user';
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

export const configProcedures = {
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
      // General-access write guard: only `edit` permits collaborative updates.
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: input.agentId,
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
            (await ctx.agentModel.existsOwnedById(input.agentId)) ||
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
      return ctx.agentService.updateAgentConfig(
        input.agentId,
        safeValue,
        input.replaceWorkingDirDeviceIds,
      );
    }),
};
