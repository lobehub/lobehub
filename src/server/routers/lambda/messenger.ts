import { DEFAULT_INBOX_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, ne, or } from 'drizzle-orm';
import { z } from 'zod';

import {
  getEnabledMessengerPlatforms,
  getMessengerDiscordConfig,
  getMessengerSlackConfig,
  getMessengerTelegramConfig,
  isMessengerPlatformEnabled,
  type MessengerPlatform,
} from '@/config/messenger';
import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import { MessengerInstallationModel } from '@/database/models/messengerInstallation';
import { agents } from '@/database/schemas';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  consumeLinkToken,
  MessengerDiscordBinder,
  MessengerSlackBinder,
  MessengerTelegramBinder,
  peekLinkToken,
} from '@/server/services/messenger';

const platformEnum = z.enum([
  'telegram',
  'slack',
  'discord',
]) satisfies z.ZodType<MessengerPlatform>;

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
  availablePlatforms: publicProcedure.query(async () => {
    const platforms = await getEnabledMessengerPlatforms();
    // Pull each platform's deep-link metadata from its DB-backed config.
    // Slack App ID is used by the verify-im success state to build a
    // `slack://app?team=…&id=…` deep link straight into the bot DM. Discord
    // Application ID doubles as the bot user id and feeds the LinkModal's
    // OAuth2 install URL.
    const [discordConfig, slackConfig, telegramConfig] = await Promise.all([
      platforms.includes('discord') ? getMessengerDiscordConfig() : Promise.resolve(null),
      platforms.includes('slack') ? getMessengerSlackConfig() : Promise.resolve(null),
      platforms.includes('telegram') ? getMessengerTelegramConfig() : Promise.resolve(null),
    ]);
    return platforms.map((platform) => ({
      appId:
        platform === 'slack'
          ? slackConfig?.appId
          : platform === 'discord'
            ? discordConfig?.applicationId
            : undefined,
      botUsername:
        platform === 'telegram'
          ? telegramConfig?.botUsername
          : platform === 'discord'
            ? discordConfig?.botUsername
            : undefined,
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
        // Tenant fields are populated by the binder for per-tenant platforms
        // (Slack workspace name) and absent for global-bot platforms; the
        // verify-im page conditionally renders the workspace blurb.
        tenantId: payload.tenantId,
        tenantName: payload.tenantName,
      };
    }),

  /**
   * Confirm the account link. Account-level: creates (or overwrites) a single
   * `messenger_account_links` row for `(userId, platform)`. `initialAgentId` is
   * required so the user's first IM message has somewhere to land — they can
   * always change it later via `/agents` (tap to switch) or the per-agent UI.
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
        tenantId: payload.tenantId ?? '',
      });

      // Best-effort confirmation back to the IM platform.
      void notifyLinkSuccess(payload.platform, {
        activeAgentName: agentRow.title ?? undefined,
        platformUserId: payload.platformUserId,
        tenantId: payload.tenantId,
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

      const updated = await ctx.messengerLinkModel.setActiveAgent(
        input.platform,
        input.agentId,
        input.tenantId,
      );
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No messenger link for this platform yet. Send /start in the bot first.',
        });
      }
      return { data: updated, success: true };
    }),

  /** Remove the user's account link for a platform (optionally scoped to one tenant). */
  unlink: messengerProcedure
    .input(z.object({ platform: platformEnum, tenantId: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      if (!(await isMessengerPlatformEnabled(input.platform))) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Messenger ${input.platform} bot is not configured`,
        });
      }
      await ctx.messengerLinkModel.deleteByPlatform(input.platform, input.tenantId);
      return { success: true };
    }),

  /**
   * List the Slack workspaces this LobeHub user has installed the bot into.
   * Used by the messenger settings page to render the "Connections" panel
   * (Manus's `manus.im/app#settings/integrations/slack` analogue). Returns
   * the safe metadata only — never the encrypted credentials.
   */
  listMyInstallations: messengerProcedure.query(async ({ ctx }) => {
    const rows = await MessengerInstallationModel.listByInstallerUserId(ctx.serverDB, ctx.userId);
    return rows.map((row) => ({
      applicationId: row.applicationId,
      enterpriseId: (row.metadata as Record<string, unknown> | null)?.enterpriseId ?? null,
      id: row.id,
      installedAt: row.createdAt,
      isEnterpriseInstall:
        (row.metadata as Record<string, unknown> | null)?.isEnterpriseInstall === true,
      platform: row.platform,
      scope: ((row.metadata as Record<string, unknown> | null)?.scope as string) ?? '',
      tenantId: row.tenantId,
      tenantName: ((row.metadata as Record<string, unknown> | null)?.tenantName as string) ?? '',
    }));
  }),

  /**
   * Disconnect a Slack install — soft-revoke the row so the router stops
   * dispatching to it and inbound webhooks short-circuit. Cascading effect on
   * `messenger_account_links` rows for that tenant is intentional: the user
   * link rows persist (so re-installing the workspace later restores the
   * binding without re-running verify-im). To wipe a user's link, call `unlink`
   * with `tenantId`.
   *
   * Slack's `auth.revoke` to also invalidate the token server-side is a
   * nice-to-have (frees a workspace bot slot), deferred to PR3.
   */
  uninstallSlack: messengerProcedure
    .input(z.object({ installationId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey().catch(() => undefined);
      const row = await MessengerInstallationModel.findById(
        ctx.serverDB,
        input.installationId,
        gateKeeper,
      );
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Installation not found' });
      }
      // Authorization: only the user who initiated the install can disconnect
      // it. Workspace admins who installed via a different LobeHub account
      // can disconnect through their own settings page.
      if (row.installedByUserId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only disconnect installations you initiated.',
        });
      }
      await MessengerInstallationModel.markRevoked(ctx.serverDB, row.id);
      return { success: true };
    }),
});

/**
 * Best-effort confirmation back to the IM platform after a successful link.
 * Slack needs `tenantId` to resolve the right per-workspace bot token; Telegram
 * is a global bot and ignores it. PR2.4 (LOBE-8453) rewires the Slack binder
 * to receive `InstallationCredentials` via the router's installation store —
 * until then this entry point falls back to no-op for Slack (binder.createClient
 * returns null in PR1's intermediate state).
 */
const notifyLinkSuccess = async (
  platform: MessengerPlatform,
  params: { activeAgentName?: string; platformUserId: string; tenantId?: string },
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
      case 'discord': {
        await new MessengerDiscordBinder().notifyLinkSuccess(params);
        break;
      }
    }
  } catch (error) {
    console.error('[messenger:notifyLinkSuccess]', error);
  }
};
