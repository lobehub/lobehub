import { fetchQrCode, pollQrStatus } from '@lobechat/chat-adapter-wechat';
import { INBOX_SESSION_ID } from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { assertBotFeatureAccess } from '@/business/server/bot/featureAccess';
import { isMessengerPlatformEnabled } from '@/config/messenger';
import type { SafeMessengerAccountLink } from '@/database/models/messengerAccountLink';
import {
  MessengerAccountLinkConflictError,
  MessengerAccountLinkModel,
  MessengerAccountLinkRelinkRequiredError,
} from '@/database/models/messengerAccountLink';
import type { LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  wechatLegacyTokenKey,
  wechatPendingPushKey,
  wechatWindowKey,
} from '@/server/services/bot/platforms/wechat/contextWindow';
import { GatewayService } from '@/server/services/gateway';
import { getBotRuntimeStatus } from '@/server/services/gateway/runtimeStatus';
import {
  acquireWechatQrFinalizeLock,
  consumeWechatQrSession,
  getMessengerRouter,
  issueWechatQrSession,
  peekWechatQrSession,
  releaseWechatQrFinalizeLock,
} from '@/server/services/messenger';
import { wechatInstallationKey } from '@/server/services/messenger/installations';

import { resolveAuthorizedAgentScope } from './agentScope';
import { messengerProcedure } from './procedures';

export const disconnectWechatAccountLink = async (
  link: SafeMessengerAccountLink,
  userId: string,
): Promise<void> => {
  const installationKey = wechatInstallationKey(link.tenantId);
  await new GatewayService().disconnectUserMessenger({
    installationKey,
    platform: 'wechat',
    userId,
  });
  // A rescan replaces the QR-issued token/baseUrl under the same installation
  // key — drop the cached Chat SDK bot so webhooks rebuild it from the new
  // credentials instead of replying through the stale client.
  getMessengerRouter().invalidateBot(installationKey);

  if (!link.applicationId) return;
  const redis = getAgentRuntimeRedisClient();
  if (redis) {
    await redis.del(
      wechatLegacyTokenKey(link.applicationId, link.tenantId),
      wechatWindowKey(link.applicationId, link.tenantId),
      wechatPendingPushKey(link.applicationId, link.tenantId),
    );
  }
};

export const wechatProcedures = {
  /** Start a user-bound, one-shot WeChat iLink QR session. */
  createWechatQrSession: messengerProcedure.mutation(async ({ ctx }) => {
    if (!(await isMessengerPlatformEnabled('wechat'))) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'messenger.error.platformNotConfigured',
      });
    }
    await assertBotFeatureAccess({
      action: 'manage',
      platform: 'wechat',
      userId: ctx.userId,
    });

    try {
      const qr = await fetchQrCode();
      if (!qr.qrcode || !qr.qrcode_img_content) {
        throw new Error('WeChat QR response is incomplete');
      }
      const session = await issueWechatQrSession({
        qrcode: qr.qrcode,
        userId: ctx.userId,
      });
      return {
        ...session,
        qrCodePayload: qr.qrcode_img_content,
        status: 'wait' as const,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        cause: error,
        code: 'BAD_GATEWAY',
        message: 'messenger.wechat.error.qrUnavailable',
      });
    }
  }),
  /**
   * Poll a QR session and finalize the user-owned account connection exactly
   * once when WeChat confirms it. The browser never receives the raw QR token
   * or bot credential bundle.
   */
  pollWechatQrSession: messengerProcedure
    .input(z.object({ sessionId: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      if (!(await isMessengerPlatformEnabled('wechat'))) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'messenger.error.platformNotConfigured',
        });
      }
      await assertBotFeatureAccess({
        action: 'manage',
        platform: 'wechat',
        userId: ctx.userId,
      });

      const session = await peekWechatQrSession(input.sessionId, ctx.userId);
      if (!session) return { status: 'expired' as const };

      let qrStatus;
      try {
        qrStatus = await pollQrStatus(session.qrcode);
      } catch (error) {
        throw new TRPCError({
          cause: error,
          code: 'BAD_GATEWAY',
          message: 'messenger.wechat.error.pollFailed',
        });
      }

      if (qrStatus.status === 'wait' || qrStatus.status === 'scaned') {
        return { status: qrStatus.status };
      }
      if (qrStatus.status === 'expired') {
        await consumeWechatQrSession(input.sessionId);
        return { status: 'expired' as const };
      }
      if (
        !qrStatus.bot_token ||
        !qrStatus.ilink_bot_id ||
        !qrStatus.ilink_user_id ||
        !qrStatus.baseurl
      ) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: 'messenger.wechat.error.incompleteConfirmation',
        });
      }

      const lockToken = await acquireWechatQrFinalizeLock(input.sessionId);
      if (!lockToken) return { status: 'scaned' as const };

      try {
        const platformUserId = qrStatus.ilink_user_id;
        const botId = qrStatus.ilink_bot_id;
        const botToken = qrStatus.bot_token;
        const baseUrl = qrStatus.baseurl;
        const existingIdentity = await MessengerAccountLinkModel.findByPlatformUser(
          ctx.serverDB,
          'wechat',
          platformUserId,
          platformUserId,
        );
        if (existingIdentity && existingIdentity.userId !== ctx.userId) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'messenger.wechat.error.alreadyLinkedToOther',
          });
        }

        const existingUserLink = await ctx.messengerLinkModel.findByPlatform('wechat');
        if (existingUserLink && existingUserLink.platformUserId !== platformUserId) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'messenger.wechat.error.unlinkBeforeRelink',
          });
        }

        // A first scan should be immediately usable, so route it to the user's
        // personal inbox (LobeAI). A rescan preserves an authorized Agent
        // choice, but repairs stale/deauthorized links with the same fallback.
        const inboxAgentId =
          (await ctx.getAgentModel().getBuiltinAgent(INBOX_SESSION_ID))?.id ?? null;
        let activeAgentId = existingUserLink?.activeAgentId ?? inboxAgentId;
        let workspaceId: string | null = null;

        if (activeAgentId) {
          try {
            workspaceId = (
              await resolveAuthorizedAgentScope(ctx.serverDB, ctx.userId, activeAgentId)
            ).workspaceId;
          } catch (error) {
            const isStaleAgent =
              error instanceof TRPCError &&
              (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
            if (!isStaleAgent || activeAgentId === inboxAgentId) throw error;

            activeAgentId = inboxAgentId;
            workspaceId = activeAgentId
              ? (await resolveAuthorizedAgentScope(ctx.serverDB, ctx.userId, activeAgentId))
                  .workspaceId
              : null;
          }
        }
        const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
        const previousWechatLink = existingUserLink
          ? await ctx.messengerLinkModel.findByIdWithCredentials(
              existingUserLink.id,
              'wechat',
              gateKeeper,
            )
          : undefined;
        const link = await ctx.serverDB.transaction(async (tx) => {
          const txDB = tx as LobeChatDatabase;
          return new MessengerAccountLinkModel(txDB, ctx.userId).upsertForPlatform(
            {
              activeAgentId,
              applicationId: botId,
              credentials: { baseUrl, botId, botToken },
              platform: 'wechat',
              platformUserId,
              platformUsername: null,
              tenantId: platformUserId,
              workspaceId,
            },
            gateKeeper,
          );
        });

        if (existingUserLink) await disconnectWechatAccountLink(existingUserLink, ctx.userId);
        const gateway = new GatewayService();
        const connectionId = await gateway.ensureUserMessengerConnected({
          installationKey: wechatInstallationKey(platformUserId),
          platform: 'wechat',
          userId: ctx.userId,
        });
        if (!connectionId) {
          // The gateway resolves credentials from the committed account link.
          // Compensate a failed first connection by deleting it; on a rescan,
          // restore the previous credential bundle so a failed replacement
          // never destroys a working user-owned connection.
          const previousApplicationId = previousWechatLink?.applicationId;
          if (previousWechatLink && previousApplicationId) {
            await ctx.serverDB.transaction(async (tx) => {
              const txDB = tx as LobeChatDatabase;
              await new MessengerAccountLinkModel(txDB, ctx.userId).upsertForPlatform(
                {
                  activeAgentId: previousWechatLink.activeAgentId,
                  applicationId: previousApplicationId,
                  credentials: previousWechatLink.credentials,
                  platform: 'wechat',
                  platformUserId: previousWechatLink.platformUserId,
                  platformUsername: previousWechatLink.platformUsername,
                  tenantId: previousWechatLink.tenantId,
                  workspaceId: previousWechatLink.workspaceId,
                },
                gateKeeper,
              );
            });
            await gateway.ensureUserMessengerConnected({
              installationKey: wechatInstallationKey(previousWechatLink.tenantId),
              platform: 'wechat',
              userId: ctx.userId,
            });
          } else {
            await ctx.serverDB.transaction(async (tx) => {
              const txDB = tx as LobeChatDatabase;
              await new MessengerAccountLinkModel(txDB, ctx.userId).deleteByPlatform(
                'wechat',
                platformUserId,
              );
            });
          }
          throw new TRPCError({
            code: 'BAD_GATEWAY',
            message: 'messenger.wechat.error.connectionFailed',
          });
        }

        const runtime = await getBotRuntimeStatus('wechat', botId);
        await consumeWechatQrSession(input.sessionId);

        return {
          installation: {
            applicationId: botId,
            id: link.id,
            installedAt: link.createdAt,
            platform: link.platform,
            tenantId: link.tenantId,
            tenantName: 'WeChat',
          },
          link,
          runtime,
          status: 'confirmed' as const,
        };
      } catch (error) {
        await releaseWechatQrFinalizeLock(input.sessionId, lockToken);
        if (error instanceof MessengerAccountLinkConflictError) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'messenger.wechat.error.alreadyLinkedToOther',
          });
        }
        if (error instanceof MessengerAccountLinkRelinkRequiredError) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'messenger.wechat.error.unlinkBeforeRelink',
          });
        }
        throw error;
      }
    }),
};
