import debug from 'debug';

import type { MessengerPlatform } from '@/config/messenger';
import {
  MessengerAccountLinkConflictError,
  MessengerAccountLinkModel,
  MessengerAccountLinkRelinkRequiredError,
} from '@/database/models/messengerAccountLink';
import type { LobeChatDatabase } from '@/database/type';

import type { NormalizedInstallation } from '../platforms/types';
import { greetAfterBind } from './greeting';
import { isBindSessionExpired, peekBindSession, settleBindSession } from './sessionStore';
import type { BindPollStatus } from './types';

const log = debug('lobe-server:messenger:bind:oauth');

/**
 * Finish a one-click bind on the OAuth callback. The install consent screen
 * already told us who approved it (Slack `authed_user.id`, Discord
 * `/users/@me`), so the person is linked right there — no second trip to DM
 * the bot and confirm on verify-im.
 *
 * Slack links are per workspace (`tenantId` = team id); Discord links span the
 * whole platform (`tenantId` = ''), matching what the verify-im flow writes.
 *
 * Settles the bind session the web page is polling and, on success, lets the
 * bound agent greet the person. Returns the settled status.
 */
export const completeOAuthBind = async (params: {
  install: NormalizedInstallation;
  platform: Extract<MessengerPlatform, 'slack' | 'discord'>;
  pollId: string;
  serverDB: LobeChatDatabase;
  userId: string;
}): Promise<BindPollStatus> => {
  const { install, platform, pollId, serverDB, userId } = params;

  const session = await peekBindSession(pollId, userId);
  // The record outlives the advertised `expiresAt` by a day so a late poll can
  // still read its outcome; a consent finished after that window must not bind.
  if (
    !session ||
    session.platform !== platform ||
    session.result.status !== 'pending' ||
    isBindSessionExpired(session)
  ) {
    log('completeOAuthBind: no live %s session %s for user=%s', platform, pollId, userId);
    return { status: 'expired' };
  }

  const platformUserId = install.installedByPlatformUserId;
  if (!platformUserId) {
    const result = { reason: 'identity_unavailable', status: 'failed' } as const;
    await settleBindSession(pollId, result);
    return result;
  }

  const tenantId = platform === 'slack' ? install.tenantId : '';
  const owner = await MessengerAccountLinkModel.findByPlatformUser(
    serverDB,
    platform,
    platformUserId,
    tenantId,
  );
  if (owner && owner.userId !== userId) {
    const result = { reason: 'already_linked_to_other', status: 'failed' } as const;
    await settleBindSession(pollId, result);
    return result;
  }

  try {
    await new MessengerAccountLinkModel(serverDB, userId).upsertForPlatform({
      activeAgentId: session.agentId,
      platform,
      platformUserId,
      platformUsername: null,
      tenantId,
      workspaceId: session.workspaceId,
    });
  } catch (error) {
    const reason =
      error instanceof MessengerAccountLinkConflictError
        ? ('already_linked_to_other' as const)
        : error instanceof MessengerAccountLinkRelinkRequiredError
          ? ('unlink_before_relink' as const)
          : undefined;
    if (!reason) throw error;
    const result = { reason, status: 'failed' } as const;
    await settleBindSession(pollId, result);
    return result;
  }

  const result = { linkedAt: Date.now(), platformUserId, status: 'linked' } as const;
  await settleBindSession(pollId, result);
  log('completeOAuthBind: linked %s user=%s tenant=%s', platform, userId, tenantId);

  await greetAfterBind({
    agentId: session.agentId,
    locale: session.locale,
    platform,
    serverDB,
    tenantId,
    userId,
  });
  return result;
};

/**
 * Settle a one-click bind whose OAuth round trip ended without an install —
 * the person denied consent, or the code exchange / install write failed — so
 * the polling page leaves its waiting state instead of spinning until expiry.
 * Only the owner's still-pending session for this platform is touched.
 */
export const failOAuthBind = async (params: {
  platform: string;
  pollId: string;
  userId: string;
}): Promise<void> => {
  const session = await peekBindSession(params.pollId, params.userId);
  if (!session || session.platform !== params.platform || session.result.status !== 'pending') {
    return;
  }
  await settleBindSession(params.pollId, { reason: 'oauth_failed', status: 'failed' });
  log('failOAuthBind: %s session %s settled as oauth_failed', params.platform, params.pollId);
};
