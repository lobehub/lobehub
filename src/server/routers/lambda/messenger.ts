import { DEFAULT_INBOX_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, ne, or } from 'drizzle-orm';
import { z } from 'zod';

import {
  getEnabledMessengerPlatforms,
  isMessengerPlatformEnabled,
  messengerEnv,
  type MessengerPlatform,
} from '@/config/messenger';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { agents } from '@/database/schemas';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  consumeLinkToken,
  MessengerSlackBinder,
  MessengerTelegramBinder,
  peekLinkToken,
} from '@/server/services/messenger';

const platformEnum = z.enum(['telegram', 'slack']) satisfies z.ZodType<MessengerPlatform>;

const messengerProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      messengerLinkModel: new MessengerAccountLinkModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const messengerRouter = router({
  /** Surface available platforms + bot deep-link metadata to the UI. */
  availablePlatforms: publicProcedure.query(() => {
    const platforms = getEnabledMessengerPlatforms();
    return platforms.map((platform) => ({
      botUsername: platform === 'telegram' ? messengerEnv.LOBE_TELEGRAM_BOT_USERNAME : undefined,
      enabled: true,
      platform,
    }));
  }),

  /**
   * Public peek used by the verify-im page to render the IM identity preview
   * before the user confirms. Does NOT consume the token.
   */
  peekLinkToken: publicProcedure
    .input(z.object({ randomId: z.string().min(8) }))
    .query(async ({ input }) => {
      const payload = await peekLinkToken(input.randomId);
      if (!payload) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Link token expired or invalid. Please return to the bot and try /start again.',
        });
      }
      return {
        platform: payload.platform,
        platformUserId: payload.platformUserId,
        platformUsername: payload.platformUsername,
      };
    }),

  /**
   * Confirm the account link. Account-level: creates (or overwrites) a single
   * `messenger_account_links` row for `(userId, platform)`. `initialAgentId` is
   * required so the user's first IM message has somewhere to land — they can
   * always change it later via `/switch` or the per-agent UI.
   */
  confirmLink: messengerProcedure
    .input(
      z.object({
        initialAgentId: z.string().min(1, 'Pick a default agent before confirming'),
        randomId: z.string().min(8),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const payload = await consumeLinkToken(input.randomId);
      if (!payload) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message:
            'Link token expired or already used. Please return to the bot and try /start again.',
        });
      }

      const [agentRow] = await ctx.serverDB
        .select({ id: agents.id, title: agents.title })
        .from(agents)
        .where(and(eq(agents.id, input.initialAgentId), eq(agents.userId, ctx.userId)))
        .limit(1);
      if (!agentRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });
      }

      const link = await ctx.messengerLinkModel.upsertForPlatform({
        activeAgentId: agentRow.id,
        platform: payload.platform,
        platformUserId: payload.platformUserId,
        platformUsername: payload.platformUsername ?? null,
      });

      // Best-effort confirmation back to the IM platform.
      void notifyLinkSuccess(payload.platform, {
        activeAgentName: agentRow.title ?? undefined,
        platformUserId: payload.platformUserId,
      });

      return { data: link, success: true };
    }),

  /**
   * Agent list for the verify-im UI's "pick an initial agent" dropdown.
   *
   * Excludes virtual agents (page-copilot, etc.) but explicitly keeps the
   * inbox/LobeAI agent — historical inbox sessions get migrated with
   * `virtual=true`, so a plain virtual filter would hide LobeAI even though
   * the home sidebar shows it (sidebar fetches it separately via
   * `agent.getBuiltinAgent`).
   *
   * Order matches the home sidebar (`updatedAt DESC`). Title fallback for the
   * inbox agent resolves to `"LobeAI"` + default avatar; everything else falls
   * back on the client via `common.defaultSession`.
   */
  listAgentsForBinding: messengerProcedure.query(async ({ ctx }) => {
    const rows = await ctx.serverDB
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        id: agents.id,
        slug: agents.slug,
        title: agents.title,
      })
      .from(agents)
      .where(
        and(
          eq(agents.userId, ctx.userId),
          or(ne(agents.virtual, true), eq(agents.slug, INBOX_SESSION_ID)),
        ),
      )
      .orderBy(desc(agents.updatedAt));

    const mapped = rows
      .filter((row) => row.id)
      .map((row) => ({
        avatar: row.avatar || (row.slug === INBOX_SESSION_ID ? DEFAULT_INBOX_AVATAR : null),
        backgroundColor: row.backgroundColor,
        id: row.id,
        slug: row.slug,
        title: row.title || (row.slug === INBOX_SESSION_ID ? 'LobeAI' : null),
      }));

    // Pin the inbox/LobeAI agent to the top regardless of updatedAt — it's the
    // implicit "default" agent and should always be the first option.
    const inboxIdx = mapped.findIndex((row) => row.slug === INBOX_SESSION_ID);
    if (inboxIdx > 0) {
      const [inbox] = mapped.splice(inboxIdx, 1);
      mapped.unshift(inbox);
    }
    return mapped.map(({ slug: _slug, ...rest }) => rest);
  }),

  /** Get the current user's link for one platform (or null). */
  getMyLink: messengerProcedure
    .input(z.object({ platform: platformEnum }))
    .query(async ({ input, ctx }) => {
      return (await ctx.messengerLinkModel.findByPlatform(input.platform)) ?? null;
    }),

  /** List all the current user's links across platforms. */
  listMyLinks: messengerProcedure.query(async ({ ctx }) => {
    return ctx.messengerLinkModel.list();
  }),

  /**
   * Set which agent the IM session routes to. Pass `agentId: null` to clear
   * the active agent (next inbound message will get the "/agents to pick"
   * prompt).
   */
  setActiveAgent: messengerProcedure
    .input(
      z.object({
        agentId: z.string().nullable(),
        platform: platformEnum,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Validate ownership when setting a non-null agent.
      if (input.agentId !== null) {
        const [agentRow] = await ctx.serverDB
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.id, input.agentId), eq(agents.userId, ctx.userId)))
          .limit(1);
        if (!agentRow) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });
        }
      }

      const updated = await ctx.messengerLinkModel.setActiveAgent(input.platform, input.agentId);
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No messenger link for this platform yet. Send /start in the bot first.',
        });
      }
      return { data: updated, success: true };
    }),

  /** Remove the user's account link for a platform. */
  unlink: messengerProcedure
    .input(z.object({ platform: platformEnum }))
    .mutation(async ({ input, ctx }) => {
      if (!isMessengerPlatformEnabled(input.platform)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Messenger ${input.platform} bot is not configured`,
        });
      }
      await ctx.messengerLinkModel.deleteByPlatform(input.platform);
      return { success: true };
    }),
});

const notifyLinkSuccess = async (
  platform: MessengerPlatform,
  params: { activeAgentName?: string; platformUserId: string },
) => {
  try {
    switch (platform) {
      case 'telegram': {
        await new MessengerTelegramBinder().notifyLinkSuccess(params);
        break;
      }
      case 'slack': {
        await new MessengerSlackBinder().notifyLinkSuccess(params);
        break;
      }
    }
  } catch (error) {
    console.error('[messenger:notifyLinkSuccess]', error);
  }
};
