import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { SafeMessengerAccountLink } from '@/database/models/messengerAccountLink';
import type { DecryptedMessengerInstallation } from '@/database/models/messengerInstallation';
import { MessengerInstallationModel } from '@/database/models/messengerInstallation';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { SlackApi } from '@/server/services/bot/platforms/slack/api';
import { getBotRuntimeStatus } from '@/server/services/gateway/runtimeStatus';

import { messengerProcedure, messengerWriteProcedure } from './procedures';
import { disconnectWechatAccountLink } from './wechat';

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

export const installationsProcedures = {
  /** List the current user's System Bot connections without credential data. */
  listMyInstallations: messengerProcedure.query(async ({ ctx }) => {
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey().catch(() => undefined);
    const [rows, links] = await Promise.all([
      MessengerInstallationModel.listByInstallerUserId(ctx.serverDB, ctx.userId, gateKeeper),
      ctx.messengerLinkModel.list(),
    ]);
    const activeRows = (
      await Promise.all(
        rows
          .filter((row) => row.platform !== 'wechat')
          .map((row) => reconcileSlackInstallation(ctx.serverDB, row)),
      )
    ).filter((row): row is DecryptedMessengerInstallation => row !== null);

    const installationViews = activeRows.map((row) => ({
      applicationId: row.applicationId,
      enterpriseId: (row.metadata as Record<string, unknown> | null)?.enterpriseId ?? null,
      id: row.id,
      installedAt: row.createdAt,
      isEnterpriseInstall:
        (row.metadata as Record<string, unknown> | null)?.isEnterpriseInstall === true,
      platform: row.platform,
      runtime: undefined,
      scope: ((row.metadata as Record<string, unknown> | null)?.scope as string) ?? '',
      tenantId: row.tenantId,
      tenantName: ((row.metadata as Record<string, unknown> | null)?.tenantName as string) ?? '',
    }));
    const wechatViews = await Promise.all(
      links
        .filter(
          (link): link is SafeMessengerAccountLink & { applicationId: string } =>
            link.platform === 'wechat' && typeof link.applicationId === 'string',
        )
        .map(async (link) => ({
          applicationId: link.applicationId,
          enterpriseId: null,
          id: link.id,
          installedAt: link.createdAt,
          isEnterpriseInstall: false,
          platform: 'wechat',
          runtime: await getBotRuntimeStatus('wechat', link.applicationId),
          scope: '',
          tenantId: link.tenantId,
          tenantName: 'WeChat',
        })),
    );

    // Telegram is deliberately absent here even though the account link makes it
    // reachable. This list doubles as send-target discovery for the client tool
    // adapter, which resolves a per-agent `botId` from `platform` and ignores
    // `messengerInstallationId` — the client adapter cannot route sends through a System Bot installation. Surfacing the synthetic
    // singleton would turn a clean "I can't reach Telegram" into a confusing
    // `No enabled bot found for platform "telegram"` for anyone who linked the
    // System Bot but has no per-agent Telegram provider. Reaching the user
    // themselves does not need this list at all — that is `sendMessengerPush`,
    // which routes through the account link directly.
    return [...installationViews, ...wechatViews];
  }),
  /**
   * Disconnect a System Bot connection. WeChat owns its credentials on the
   * account link, so disconnecting deletes that user-owned aggregate. Other
   * tenant platforms revoke their shared installation row.
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
      const wechatLink = await ctx.messengerLinkModel.findById(input.installationId, 'wechat');
      if (wechatLink) {
        await ctx.messengerLinkModel.delete(wechatLink.id);
        await disconnectWechatAccountLink(wechatLink, ctx.userId);
        return { success: true };
      }

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
};
