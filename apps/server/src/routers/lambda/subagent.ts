import type { SubagentItem } from '@lobechat/types';
import { createSubagentSchema, updateSubagentSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import {
  SubagentModel,
  SubagentNameConflictError,
  SubagentParentNotFoundError,
} from '@/database/models/subagent';
import { ThreadModel } from '@/database/models/thread';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { assertCanEditResource } from '@/server/services/resourcePermission';

import { getResourceConfigAccess } from './_helpers/resourceConfigGuard';

const subagentProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      subagentModel: new SubagentModel(ctx.serverDB, ctx.userId, wsId),
      threadModel: new ThreadModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

const toTRPCError = (error: unknown): never => {
  if (error instanceof SubagentNameConflictError)
    throw new TRPCError({ code: 'CONFLICT', message: 'DUPLICATE_SUBAGENT_NAME' });
  if (error instanceof SubagentParentNotFoundError)
    throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
  throw error;
};

interface PermissionCtx {
  serverDB: Parameters<typeof getResourceConfigAccess>[0]['db'];
  userId: string;
  workspaceId?: string | null;
  workspacePermissionCodes?: string[];
}

/** A preset is part of its parent agent's config: same read access as the agent's config. */
const getParentConfigAccess = (ctx: PermissionCtx, parentAgentId: string) =>
  getResourceConfigAccess(
    {
      db: ctx.serverDB,
      grantedPermissions: ctx.workspacePermissionCodes,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    },
    'agent',
    parentAgentId,
  );

/** View/use members only need a preset's identity to label threads, not its config. */
const redactSubagent = (preset: SubagentItem): SubagentItem => ({
  createdAt: preset.createdAt,
  description: preset.description,
  id: preset.id,
  isEnabled: preset.isEnabled,
  model: null,
  name: preset.name,
  parentAgentId: preset.parentAgentId,
  provider: null,
  reasoningEffort: null,
  systemRole: null,
  tools: null,
  updatedAt: preset.updatedAt,
});

/** Editing a preset is editing its parent agent: only `edit` access qualifies. */
const assertCanEditParent = (ctx: PermissionCtx, parentAgentId: string) =>
  assertCanEditResource({
    db: ctx.serverDB,
    resourceId: parentAgentId,
    resourceType: 'agent',
    userId: ctx.userId,
    workspaceId: ctx.workspaceId ?? undefined,
  });

/** Subagent presets: per-agent configuration, never listed alongside agents. */
export const subagentRouter = router({
  createSubagent: subagentProcedure
    .use(withScopedPermission('agent:update'))
    .input(createSubagentSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanEditParent(ctx, input.parentAgentId);

      return ctx.subagentModel.create(input).catch(toTRPCError);
    }),

  getSubagent: subagentProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const preset = await ctx.subagentModel.findById(input.id);
      if (!preset) return null;

      const access = await getParentConfigAccess(ctx, preset.parentAgentId);
      if (access === 'none') return null;
      return access === 'profile' ? redactSubagent(preset) : preset;
    }),

  /** Thread count and token usage per preset of one parent agent. */
  getSubagentStats: subagentProcedure
    .input(z.object({ parentAgentId: z.string() }))
    .query(async ({ ctx, input }) => {
      if ((await getParentConfigAccess(ctx, input.parentAgentId)) === 'none') return [];

      const presets = await ctx.subagentModel.queryByParentAgentId(input.parentAgentId);
      return ctx.threadModel.countBySubagentIds(presets.map((preset) => preset.id));
    }),

  /** Threads a preset ran, newest first. */
  getSubagentThreads: subagentProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        subagentId: z.string(),
      }),
    )
    .query(async ({ ctx, input: { subagentId, ...page } }) => {
      const preset = await ctx.subagentModel.findById(subagentId);
      if (!preset || (await getParentConfigAccess(ctx, preset.parentAgentId)) === 'none') return [];

      return ctx.threadModel.queryBySubagentId(subagentId, page);
    }),

  getSubagents: subagentProcedure
    .input(z.object({ parentAgentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const access = await getParentConfigAccess(ctx, input.parentAgentId);
      if (access === 'none') return [];

      const presets = await ctx.subagentModel.queryByParentAgentId(input.parentAgentId);
      return access === 'profile' ? presets.map(redactSubagent) : presets;
    }),

  removeSubagent: subagentProcedure
    .use(withScopedPermission('agent:update'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const preset = await ctx.subagentModel.findById(input.id);
      if (!preset) return;
      await assertCanEditParent(ctx, preset.parentAgentId);

      await ctx.subagentModel.delete(input.id);
    }),

  updateSubagent: subagentProcedure
    .use(withScopedPermission('agent:update'))
    .input(z.object({ id: z.string(), value: updateSubagentSchema }))
    .mutation(async ({ ctx, input }) => {
      const preset = await ctx.subagentModel.findById(input.id);
      if (!preset) throw new TRPCError({ code: 'NOT_FOUND', message: 'Subagent not found' });
      await assertCanEditParent(ctx, preset.parentAgentId);

      return ctx.subagentModel.update(input.id, input.value).catch(toTRPCError);
    }),
});
