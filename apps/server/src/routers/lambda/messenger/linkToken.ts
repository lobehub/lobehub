import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { type MessengerPlatform } from '@/config/messenger';
import {
  MessengerAccountLinkConflictError,
  MessengerAccountLinkModel,
  MessengerAccountLinkRelinkRequiredError,
} from '@/database/models/messengerAccountLink';
import { users } from '@/database/schemas';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  consumeLinkToken,
  MessengerDiscordBinder,
  MessengerSlackBinder,
  MessengerTelegramBinder,
  peekConsumedLinkToken,
  peekLinkToken,
} from '@/server/services/messenger';

import { resolveAuthorizedAgentScope } from './agentScope';
import { messengerProcedure } from './procedures';

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

export const linkTokenRouter = router({
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
});
