import { z } from 'zod';

import { assertCanEditResource } from '@/server/services/resourcePermission';

import {
  getResourceConfigAccess,
  redactAgentConfig,
  redactGroupConfig,
  type ResourceConfigAccess,
} from '../_helpers/resourceConfigGuard';
import { agentGroupProcedure } from './procedures';

const resourceConfigGuardCtx = (ctx: {
  serverDB: Parameters<typeof getResourceConfigAccess>[0]['db'];
  userId: string;
  workspaceId?: string | null;
  workspacePermissionCodes?: string[];
}) => ({
  db: ctx.serverDB,
  grantedPermissions: ctx.workspacePermissionCodes,
  userId: ctx.userId,
  workspaceId: ctx.workspaceId,
});

const getGroupConfigAccess = <T extends Record<string, any>>(
  ctx: {
    serverDB: Parameters<typeof getResourceConfigAccess>[0]['db'];
    userId: string;
    workspaceId?: string | null;
    workspacePermissionCodes?: string[];
  },
  group: T,
): Promise<ResourceConfigAccess> =>
  getResourceConfigAccess(resourceConfigGuardCtx(ctx), 'agentGroup', group.id, {
    userId: group.userId,
    visibility: group.visibility ?? null,
    workspaceId: group.workspaceId ?? null,
  });

const protectGroupMemberConfigs = async <T extends Record<string, any>>(
  ctx: Parameters<typeof resourceConfigGuardCtx>[0],
  group: T,
): Promise<T> => {
  if (!Array.isArray(group.agents) || group.agents.length === 0) return group;

  let changed = false;
  const protectedAgents = await Promise.all(
    group.agents.map(async (agent: Record<string, any>) => {
      const knownMeta =
        agent.userId && agent.workspaceId !== undefined
          ? {
              userId: agent.userId,
              visibility: agent.visibility ?? null,
              workspaceId: agent.workspaceId ?? null,
            }
          : undefined;
      const access = await getResourceConfigAccess(
        resourceConfigGuardCtx(ctx),
        'agent',
        agent.id,
        knownMeta,
      );

      if (access === 'none') {
        changed = true;
        return null;
      }
      if (access === 'profile') {
        changed = true;
        return redactAgentConfig(agent);
      }
      return agent;
    }),
  );

  return changed ? ({ ...group, agents: protectedAgents.filter(Boolean) } as T) : group;
};

export const queryProcedures = {
  getGroup: agentGroupProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const group = await ctx.chatGroupModel.findById(input.id);
      if (!group) return group;
      const access = await getGroupConfigAccess(ctx, group);
      if (access === 'none') return undefined;
      return access === 'profile' ? redactGroupConfig(group) : group;
    }),
  getGroupAgents: agentGroupProcedure
    .input(z.object({ groupId: z.string() }))
    .query(async ({ input, ctx }) => {
      await assertCanEditResource({
        db: ctx.serverDB,
        resourceId: input.groupId,
        resourceType: 'agentGroup',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });

      return ctx.chatGroupModel.getGroupAgents(input.groupId);
    }),
  /**
   * Get a group by forkedFromIdentifier stored in config
   * @returns group id if exists, null otherwise
   */
  getGroupByForkedFromIdentifier: agentGroupProcedure
    .input(
      z.object({
        forkedFromIdentifier: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.chatGroupModel.getGroupByForkedFromIdentifier(input.forkedFromIdentifier);
    }),
  getGroupDetail: agentGroupProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const detail = await ctx.agentGroupService.getGroupDetail(input.id);
      if (!detail) return null;
      const access = await getGroupConfigAccess(ctx, detail);
      if (access === 'none') return null;
      if (access === 'profile') return redactGroupConfig(detail);

      const defaultAgentConfig = await ctx.userModel.getUserSettingsDefaultAgentConfig();
      return protectGroupMemberConfigs(ctx, {
        ...detail,
        agents: ctx.agentGroupService.mergeAgentsDefaultConfig(defaultAgentConfig, detail.agents),
      });
    }),
  getGroups: agentGroupProcedure.query(async ({ ctx }) => {
    const groups = await ctx.agentGroupService.getGroups();
    const accessLevels = await Promise.all(groups.map((group) => getGroupConfigAccess(ctx, group)));
    const hasFullConfig = accessLevels.includes('full');
    const defaultAgentConfig = hasFullConfig
      ? await ctx.userModel.getUserSettingsDefaultAgentConfig()
      : undefined;

    const protectedGroups = await Promise.all(
      groups.map(async (group, index) => {
        const access = accessLevels[index];
        if (access === 'none') return null;
        if (access === 'profile') return redactGroupConfig(group);
        if (!defaultAgentConfig) return group;

        return protectGroupMemberConfigs(ctx, {
          ...group,
          agents: ctx.agentGroupService.mergeAgentsDefaultConfig(defaultAgentConfig, group.agents),
        });
      }),
    );

    return protectedGroups.filter((group): group is NonNullable<typeof group> => Boolean(group));
  }),
  /**
   * Members these groups only reference (the roster's `External` rows).
   *
   * Asked before a transfer: those agents stay in the source scope and the
   * group takes clones of them instead, which is a visible enough change that
   * the user should agree to it up front.
   */
  listReferencedMembers: agentGroupProcedure
    .input(z.object({ groupIds: z.array(z.string()).min(1).max(100) }))
    .query(async ({ input, ctx }) => {
      return ctx.agentGroupRepo.listReferencedMembers([...new Set(input.groupIds)]);
    }),
};
