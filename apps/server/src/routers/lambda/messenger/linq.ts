import { buildLinqDeepLink, createLinqLinkCode } from '@lobechat/agent-address-linq';
import { INBOX_SESSION_ID } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { assertBotFeatureAccess } from '@/business/server/bot/featureAccess';
import { getMessengerLinqConfig } from '@/config/messenger';
import { router } from '@/libs/trpc/lambda';
import { issueLinkCode, peekLinkCodeStatus } from '@/server/services/messenger/linkTokenStore';
import { pickLinqPoolNumber } from '@/server/services/messenger/platforms/linq/pool';

import { resolveAuthorizedAgentScope } from './agentScope';
import { messengerProcedure } from './procedures';

export const linqRouter = router({
  /**
   * Start an iMessage / SMS link on the shared Linq pool. The signed-in user
   * gets a one-time code plus `sms:` / `imessage:` deep links prefilled with
   * it; texting that code from their phone to the pool is what binds the
   * sender's handle to this account (see `MessengerLinqBinder`). The pool
   * number is only a destination — any number in the pool would route the
   * same way, because inbound is matched by sender, never by number.
   */
  createLinqLink: messengerProcedure.mutation(async ({ ctx }) => {
    const config = await getMessengerLinqConfig();
    if (!config) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'messenger.error.platformNotConfigured',
      });
    }
    await assertBotFeatureAccess({ action: 'manage', platform: 'linq', userId: ctx.userId });

    const existing = await ctx.messengerLinkModel.findByPlatform('linq', '');
    if (existing) {
      throw new TRPCError({ code: 'CONFLICT', message: 'verify.error.unlinkBeforeRelink' });
    }

    // Same default as a first WeChat scan: land on the personal inbox agent so
    // the first message after linking already has somewhere to go.
    const activeAgentId = (await ctx.getAgentModel().getBuiltinAgent(INBOX_SESSION_ID))?.id ?? null;
    const workspaceId = activeAgentId
      ? (await resolveAuthorizedAgentScope(ctx.serverDB, ctx.userId, activeAgentId)).workspaceId
      : null;

    const { code, expiresAt, pollId } = await issueLinkCode({
      activeAgentId,
      mintCode: createLinqLinkCode,
      platform: 'linq',
      userId: ctx.userId,
      workspaceId,
    });

    const deepLink = buildLinqDeepLink({
      code,
      number: pickLinqPoolNumber(config.numbers, ctx.userId),
    });
    if (!deepLink) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'messenger.error.platformNotConfigured',
      });
    }

    return { code, deepLink, expiresAt, pollId };
  }),
  /** Poll a Linq link started by `createLinqLink` until the code arrives. */
  pollLinqLink: messengerProcedure
    .input(z.object({ pollId: z.string().min(8) }))
    .query(async ({ ctx, input }) => {
      const result = await peekLinkCodeStatus(input.pollId, ctx.userId);
      if (result.status !== 'linked') return result;

      const link = await ctx.messengerLinkModel.findByPlatform('linq', '');
      return { ...result, link: link ?? null };
    }),
});
