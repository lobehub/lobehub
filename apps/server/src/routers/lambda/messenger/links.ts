import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { isMessengerPlatformEnabled, type MessengerPlatform } from '@/config/messenger';

import { resolveAuthorizedAgentScope } from './agentScope';
import { messengerProcedure, messengerWriteProcedure } from './procedures';
import { disconnectWechatAccountLink } from './wechat';

const platformEnum = z.enum([
  'telegram',
  'slack',
  'discord',
  'wechat',
  'linq',
]) satisfies z.ZodType<MessengerPlatform>;

export const linksProcedures = {
  /**
   * Get the current user's link for one platform (or null). `tenantId`
   * narrows to a specific Slack workspace; omit for Telegram (global bot).
   */
  getMyLink: messengerProcedure
    .input(z.object({ platform: platformEnum, tenantId: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      return (await ctx.messengerLinkModel.findByPlatform(input.platform, input.tenantId)) ?? null;
    }),
  /** List all the current user's links across platforms (and tenants). */
  listMyLinks: messengerProcedure.query(async ({ ctx }) => {
    return ctx.messengerLinkModel.list();
  }),
  /**
   * Set which agent the IM session routes to. Pass `agentId: null` to clear
   * the active agent (next inbound message will get the "/agents to pick"
   * prompt). Pass `tenantId` to scope to a specific Slack workspace.
   */
  setActiveAgent: messengerProcedure
    .input(
      z.object({
        agentId: z.string().nullable(),
        platform: platformEnum,
        tenantId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Authorize the target agent against its own workspace and derive the
      // active scope (personal → null). Clearing (`agentId: null`) resets to
      // personal scope.
      let workspaceId: string | null = null;
      if (input.agentId !== null) {
        const scope = await resolveAuthorizedAgentScope(ctx.serverDB, ctx.userId, input.agentId);
        workspaceId = scope.workspaceId;
      }

      const updated = await ctx.messengerLinkModel.setActiveAgent(
        input.platform,
        input.agentId,
        workspaceId,
        input.tenantId,
      );
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'messenger.error.linkRequired',
        });
      }
      return { data: updated, success: true };
    }),
  /** Remove the user's account link for a platform (optionally scoped to one tenant). */
  unlink: messengerWriteProcedure
    .input(z.object({ platform: platformEnum, tenantId: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      if (input.platform !== 'wechat' && !(await isMessengerPlatformEnabled(input.platform))) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'messenger.error.platformNotConfigured',
        });
      }

      if (input.platform === 'wechat') {
        const links = (await ctx.messengerLinkModel.list()).filter(
          (link) =>
            link.platform === 'wechat' &&
            (input.tenantId === undefined || link.tenantId === input.tenantId),
        );

        await ctx.messengerLinkModel.deleteByPlatform('wechat', input.tenantId);
        await Promise.all(links.map((link) => disconnectWechatAccountLink(link, ctx.userId)));
        return { success: true };
      }

      await ctx.messengerLinkModel.deleteByPlatform(input.platform, input.tenantId);
      return { success: true };
    }),
};
