import { DEFAULT_INBOX_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, ne, or } from 'drizzle-orm';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import {
  getEnabledMessengerPlatforms,
  getMessengerDiscordConfig,
  getMessengerSlackConfig,
  getMessengerTelegramConfig,
  isMessengerPlatformEnabled,
  type MessengerPlatform,
} from '@/config/messenger';
import {
  MessengerAccountLinkConflictError,
  MessengerAccountLinkModel,
  MessengerAccountLinkRelinkRequiredError,
} from '@/database/models/messengerAccountLink';
import type { DecryptedMessengerInstallation } from '@/database/models/messengerInstallation';
import { MessengerInstallationModel } from '@/database/models/messengerInstallation';
import { RbacModel } from '@/database/models/rbac';
import { WorkspaceModel } from '@/database/models/workspace';
import { agents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { buildWorkspaceWhere } from '@/database/utils/workspace';
import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { SlackApi } from '@/server/services/bot/platforms/slack/api';
import {
  consumeLinkToken,
  MessengerDiscordBinder,
  messengerPlatformRegistry,
  MessengerSlackBinder,
  MessengerTelegramBinder,
  peekConsumedLinkToken,
  peekLinkToken,
} from '@/server/services/messenger';

const platformEnum = z.enum([
  'telegram',
  'slack',
  'discord',
]) satisfies z.ZodType<MessengerPlatform>;

const REVOKED_SLACK_AUTH_ERRORS = new Set([
  'account_inactive',
  'invalid_auth',
  'not_authed',
  'token_revoked',
]);

const extractSlackAuthErrorCode = (error: unknown): string | null => {
  if (!(error instanceof Error)) return null;

  const match = error.message.match(/Slack API auth\.test failed: ([a-z_]+)/);
  return match?.[1] ?? null;
};

const WORKSPACE_FEATURE_DISABLED_MESSAGE = 'Workspace feature is not enabled for this user';

const isWorkspaceFeatureEnabledForUser = async (userId: string): Promise<boolean> => {
  const featureFlags = await getServerFeatureFlagsStateFromRuntimeConfig(userId);
  return featureFlags.enableWorkspace === true;
};

const assertWorkspaceFeatureEnabledForUser = async (userId: string): Promise<void> => {
  if (await isWorkspaceFeatureEnabledForUser(userId)) return;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: WORKSPACE_FEATURE_DISABLED_MESSAGE,
  });
};

const reconcileSlackInstallation = async (
  serverDB: LobeChatDatabase,
  row: DecryptedMessengerInstallation,
): Promise<DecryptedMessengerInstallation | null> => {
  if (row.platform !== 'slack') return row;

  const botToken = (row.credentials as { botToken?: string })?.botToken;
  if (!botToken) return row;

  try {
    await new SlackApi(botToken).authTest();
    return row;
  } catch (error) {
    const errorCode = extractSlackAuthErrorCode(error);

    if (errorCode && REVOKED_SLACK_AUTH_ERRORS.has(errorCode)) {
      await MessengerInstallationModel.markRevoked(serverDB, row.id);
      return null;
    }

    console.error('[messenger:listMyInstallations] failed to verify Slack installation', error);
    return row;
  }
};

/**
 * Reveal enough of the email so a legitimate owner recognizes the account
 * without exposing the full address to anyone with Slack-side access to
 * the IM identity.
 */
const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***@${domain}`;
};

const messengerProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      // The System Bot is a single shared bot; the workspace a conversation
      // runs in is derived from the *active agent*, not the ambient
      // `X-Workspace-Id` header. So the link model is identity-scoped (by
      // userId), and per-agent authorization happens in-handler via
      // `resolveAuthorizedAgentScope`.
      messengerLinkModel: new MessengerAccountLinkModel(ctx.serverDB, ctx.userId),
    },
  });
});
const messengerWriteProcedure = messengerProcedure.use(withScopedPermission('agent:update'));

/**
 * Resolve the workspace scope of an agent the user wants to route the System
 * Bot to, authorizing access along the way. Because the bot is shared and
 * which LobeHub context a conversation runs in is derived from the *active
 * agent*, every place that sets the active agent must re-authorize against
 * that agent's own workspace:
 *
 * - personal agent (`workspace_id IS NULL`): must be owned by the caller.
 * - workspace agent: caller must be a member AND hold `agent:update` in that
 *   workspace (mirrors `withScopedPermission('agent:update')`).
 *
 * Returns the derived `workspaceId` (null for personal) + the agent title.
 * Throws `NOT_FOUND` / `FORBIDDEN`.
 */
const resolveAuthorizedAgentScope = async (
  serverDB: LobeChatDatabase,
  userId: string,
  agentId: string,
): Promise<{ title: string | null; workspaceId: string | null }> => {
  const [agentRow] = await serverDB
    .select({ title: agents.title, userId: agents.userId, workspaceId: agents.workspaceId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agentRow) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'messenger.error.agentNotFound' });
  }

  // Personal agent — only the owner may route the bot to it.
  if (!agentRow.workspaceId) {
    if (agentRow.userId !== userId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'messenger.error.agentNotFound' });
    }
    return { title: agentRow.title, workspaceId: null };
  }

  // Workspace agent — caller must be a member with `agent:update`.
  await assertWorkspaceFeatureEnabledForUser(userId);

  const userWorkspaces = await new WorkspaceModel(serverDB, userId).listUserWorkspaces();
  const isMember = userWorkspaces.some((w) => w.id === agentRow.workspaceId);
  if (!isMember) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'messenger.error.agentNotFound' });
  }
  const allowed = await new RbacModel(serverDB, userId).hasAnyPermission(
    ['agent:update:all', 'agent:update:owner'],
    { workspaceId: agentRow.workspaceId },
  );
  if (!allowed) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'messenger.error.agentNotFound' });
  }
  return { title: agentRow.title, workspaceId: agentRow.workspaceId };
};

export const messengerRouter = router({
  /**
   * Surface available platforms + bot deep-link metadata to the UI.
   *
   * The static per-platform fields (`id`, `name`, ...) come from the
   * registry's serialized definitions — same pattern as
   * `agentBotProvider.listPlatforms` for bot channels. Per-deployment
   * fields (`appId`, `botUsername`) layer on top from each platform's
   * DB-backed config:
   *
   * - Slack `appId` powers the verify-im success state's
   *   `slack://app?team=…&id=…` deep link straight into the bot DM.
   * - Discord `applicationId` doubles as the bot user id and feeds the
   *   LinkModal's OAuth2 install URL.
   */
  availablePlatforms: publicProcedure.query(async () => {
    const enabled = await getEnabledMessengerPlatforms();
    const enabledSet = new Set<string>(enabled);
    const definitions = messengerPlatformRegistry
      .listSerializedPlatforms()
      .filter((def) => enabledSet.has(def.id));

    const [discordConfig, slackConfig, telegramConfig] = await Promise.all([
      enabledSet.has('discord') ? getMessengerDiscordConfig() : Promise.resolve(null),
      enabledSet.has('slack') ? getMessengerSlackConfig() : Promise.resolve(null),
      enabledSet.has('telegram') ? getMessengerTelegramConfig() : Promise.resolve(null),
    ]);

    return definitions.map((def) => ({
      ...def,
      appId:
        def.id === 'slack'
          ? slackConfig?.appId
          : def.id === 'discord'
            ? discordConfig?.applicationId
            : undefined,
      // Telegram-only: deep-link target (`https://t.me/<botUsername>`) — no
      // direct equivalent on Slack/Discord, both of which use App/Application
      // IDs to deep-link to the bot.
      botUsername: def.id === 'telegram' ? telegramConfig?.botUsername : undefined,
      enabled: true,
      // Legacy field — older callers index by `.platform` rather than `.id`.
      // Keep until those callers migrate; safe alias of the registry id.
      platform: def.id,
    }));
  }),

  /**
   * Public peek used by the verify-im page to render the IM identity preview
   * before the user confirms. Does NOT consume the token.
   *
   * Also surfaces `linkedToEmail` when the IM identity is already bound to
   * a LobeHub account — the page uses it to warn the user before they create
   * a duplicate that would either fail the unique index or shadow another
   * account's binding. Email is partially masked for privacy.
   *
   * Returns a discriminated union by `status`:
   * - `active`: token is live; payload + linkedToEmail accompany it.
   * - `consumed`: token was already consumed by a successful `confirmLink`.
   *   The page can show "binding succeeded" instead of a misleading
   *   "expired" error when the user refreshes after confirming.
   * - `expired`: no live token and no consumed marker — TTL ran out before
   *   the user finished binding.
   *
   * This procedure intentionally does NOT throw for the `consumed` /
   * `expired` cases — both are routine user states (post-confirm refresh,
   * stale tab) and shouldn't be logged as tRPC handler errors.
   */
  peekLinkToken: publicProcedure
    .use(serverDatabase)
    .input(z.object({ randomId: z.string().min(8) }))
    .query(async ({ input, ctx }) => {
      const payload = await peekLinkToken(input.randomId);
      if (!payload) {
        const consumed = await peekConsumedLinkToken(input.randomId);
        if (consumed) {
          return {
            platform: consumed.platform,
            status: 'consumed' as const,
            tenantId: consumed.tenantId,
          };
        }
        return { status: 'expired' as const };
      }

      const existingLink = await MessengerAccountLinkModel.findByPlatformUser(
        ctx.serverDB,
        payload.platform,
        payload.platformUserId,
        payload.tenantId ?? '',
      );

      let linkedToEmail: string | null = null;
      if (existingLink) {
        const [owner] = await ctx.serverDB
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, existingLink.userId))
          .limit(1);
        if (owner?.email) linkedToEmail = maskEmail(owner.email);
      }

      return {
        // Set when the IM identity is already linked to some LobeHub account.
        // The verify-im page compares against the current session email and
        // shows a warning when they don't match.
        linkedToEmail,
        platform: payload.platform,
        platformUserId: payload.platformUserId,
        platformUsername: payload.platformUsername,
        status: 'active' as const,
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
        initialAgentId: z.string().min(1, 'messenger.error.pickDefaultAgent'),
        randomId: z.string().min(8),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Peek first so a cross-user conflict / missing agent doesn't burn the
      // one-shot token — the user can fix the issue (re-login, pick another
      // agent) without going back to the bot for a fresh /start.
      const peeked = await peekLinkToken(input.randomId);
      if (!peeked) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'verify.error.expired',
        });
      }

      // Cross-user conflict: the (platform, tenant, platformUserId) tuple is
      // already bound to a different LobeHub account. The DB unique index
      // would surface this as an opaque "duplicate key" — replace with a
      // user-facing 409 carrying the masked email of the existing owner.
      const existingLink = await MessengerAccountLinkModel.findByPlatformUser(
        ctx.serverDB,
        peeked.platform,
        peeked.platformUserId,
        peeked.tenantId ?? '',
      );
      if (existingLink && existingLink.userId !== ctx.userId) {
        // The verify-im page surfaces the same conflict (with the masked
        // email of the existing owner) via peekLinkToken's `linkedToEmail`
        // before the user even clicks confirm — this throw is the defensive
        // backstop for the rare race / direct-API caller.
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'verify.error.alreadyLinkedToOther',
        });
      }

      // The verify-im flow should never silently replace an existing binding
      // for the same scope. For Slack the scope is one workspace (tenantId);
      // for Discord/Telegram it is the whole platform. Require an explicit
      // unlink first so account switches stay deliberate.
      const existingUserLink = await ctx.messengerLinkModel.findByPlatform(
        peeked.platform,
        peeked.tenantId ?? '',
      );
      if (existingUserLink && existingUserLink.platformUserId !== peeked.platformUserId) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'verify.error.unlinkBeforeRelink',
        });
      }

      // Authorize the chosen initial agent against its own workspace (personal
      // or a workspace the user can access) and derive the active scope.
      const agentScope = await resolveAuthorizedAgentScope(
        ctx.serverDB,
        ctx.userId,
        input.initialAgentId,
      );

      // Now safe to consume — token is single-use; do this last so any error
      // above leaves the token available for retry.
      const payload = await consumeLinkToken(input.randomId);
      if (!payload) {
        // Lost a race with another consumer (or the token expired during the
        // checks above). Treat the same as the initial peek-miss.
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'verify.error.expired',
        });
      }

      let link;
      try {
        link = await ctx.messengerLinkModel.upsertForPlatform({
          activeAgentId: input.initialAgentId,
          platform: payload.platform,
          platformUserId: payload.platformUserId,
          platformUsername: payload.platformUsername ?? null,
          tenantId: payload.tenantId ?? '',
          workspaceId: agentScope.workspaceId,
        });
      } catch (error) {
        // Race backstop: the IM identity got bound to another LobeHub user
        // between the pre-check above and the upsert. Re-surface as the same
        // friendly 409 the verify-im UI already knows how to render.
        if (error instanceof MessengerAccountLinkConflictError) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'verify.error.alreadyLinkedToOther',
          });
        }
        if (error instanceof MessengerAccountLinkRelinkRequiredError) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'verify.error.unlinkBeforeRelink',
          });
        }
        throw error;
      }

      // Best-effort confirmation back to the IM platform.
      void notifyLinkSuccess(payload.platform, {
        activeAgentName: agentScope.title ?? undefined,
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
  listAgentsForBinding: messengerProcedure
    .input(z.object({ workspaceId: z.string().nullish() }).optional())
    .query(async ({ ctx, input }) => {
      const { serverDB, userId } = ctx;
      // Cascading scope: the caller picks a scope (personal or one of the
      // workspaces they belong to) and we return just that scope's agents.
      // Omitting `workspaceId` (or `null`) means personal.
      const workspaceId = input?.workspaceId ?? null;

      // Authorize the requested scope. Personal is always the caller's own; a
      // workspace scope requires membership, otherwise the caller could
      // enumerate another workspace's agents.
      if (workspaceId) {
        await assertWorkspaceFeatureEnabledForUser(userId);

        const userWorkspaces = await new WorkspaceModel(serverDB, userId).listUserWorkspaces();
        if (!userWorkspaces.some((w) => w.id === workspaceId)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'messenger.error.agentNotFound' });
        }
      }

      const rows = await serverDB
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
            buildWorkspaceWhere({ userId, workspaceId: workspaceId ?? undefined }, agents),
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

      // Pin the inbox/LobeAI agent to the top regardless of updatedAt — it's
      // the implicit "default" agent and should always be the first option.
      const inboxIdx = mapped.findIndex((row) => row.slug === INBOX_SESSION_ID);
      if (inboxIdx > 0) {
        const [inbox] = mapped.splice(inboxIdx, 1);
        mapped.unshift(inbox);
      }
      return mapped.map(({ slug, ...rest }) => ({
        ...rest,
        isInbox: slug === INBOX_SESSION_ID,
      }));
    }),

  /**
   * List the scopes the user can route the System Bot to: their personal space
   * plus every workspace they belong to. Drives the connection card's
   * first-level "scope" selector; the second level then calls
   * `listAgentsForBinding({ workspaceId })` for the picked scope. Personal scope
   * is implicit (the client prepends it) — this only returns workspaces, so in
   * OSS / personal-only deployments it's simply an empty array.
   */
  listBindingScopes: messengerProcedure.query(async ({ ctx }) => {
    if (!(await isWorkspaceFeatureEnabledForUser(ctx.userId))) return [];

    const workspaces = await new WorkspaceModel(ctx.serverDB, ctx.userId).listUserWorkspaces();
    return workspaces.map((w) => ({ avatar: w.avatar, id: w.id, name: w.name }));
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
      if (!(await isMessengerPlatformEnabled(input.platform))) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'messenger.error.platformNotConfigured',
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
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey().catch(() => undefined);
    const rows = await MessengerInstallationModel.listByInstallerUserId(
      ctx.serverDB,
      ctx.userId,
      gateKeeper,
    );
    const activeRows = (
      await Promise.all(rows.map((row) => reconcileSlackInstallation(ctx.serverDB, row)))
    ).filter((row): row is DecryptedMessengerInstallation => row !== null);

    return activeRows.map((row) => ({
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
   * Disconnect a per-tenant install row. Platform-agnostic — the underlying
   * action is `markRevoked`, which the router uses to short-circuit inbound
   * traffic.
   *
   * Semantics differ per platform: for Slack, revoking the row freezes the
   * workspace's bot since dispatch is gated on the install token. For Discord,
   * the runtime still uses the global env-side bot token, so revoking only
   * removes the audit/listing entry — the bot itself remains in the guild
   * until an admin removes it. UI copy is responsible for surfacing this.
   *
   * Cascading effect on `messenger_account_links` rows for that tenant is
   * intentional: link rows persist so re-installing later restores the
   * binding without re-running verify-im. To wipe a user's link, call `unlink`
   * with `tenantId`.
   *
   * Slack's `auth.revoke` to invalidate the token server-side is a
   * nice-to-have (frees a workspace bot slot), deferred to PR3.
   */
  uninstallInstallation: messengerWriteProcedure
    .input(z.object({ installationId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey().catch(() => undefined);
      const row = await MessengerInstallationModel.findById(
        ctx.serverDB,
        input.installationId,
        gateKeeper,
      );
      if (!row) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'messenger.error.installationNotFound',
        });
      }
      // Authorization: only the user who initiated the install can disconnect
      // it. Workspace admins who installed via a different LobeHub account
      // can disconnect through their own settings page.
      if (row.installedByUserId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'messenger.error.disconnectNotAllowed',
        });
      }
      await MessengerInstallationModel.markRevoked(ctx.serverDB, row.id);
      return { success: true };
    }),
});

/**
 * Best-effort confirmation back to the IM platform after a successful link.
 * Slack needs `tenantId` to resolve the right per-workspace bot token; Telegram
 * is a global bot and ignores it. PR2.4 () rewires the Slack binder
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
