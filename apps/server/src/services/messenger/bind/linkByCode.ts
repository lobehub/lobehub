import debug from 'debug';

import type { MessengerPlatform } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import {
  MessengerAccountLinkConflictError,
  MessengerAccountLinkModel,
  MessengerAccountLinkRelinkRequiredError,
} from '@/database/models/messengerAccountLink';

import {
  consumeLinkCode,
  type LinkCodePayload,
  restoreLinkCode,
  settleLinkCode,
} from '../linkTokenStore';

const log = debug('lobe-server:messenger:bind:link-by-code');

export type LinkByCodeOutcome =
  | { payload: LinkCodePayload; status: 'linked' }
  | { status: 'already_linked_to_other' | 'invalid' | 'unlink_before_relink' };

/**
 * Bind an IM sender to whoever minted `code` on the web. Shared by every
 * web-initiated link: iMessage (the code arrives as a text) and Telegram (the
 * code arrives as the `/start` payload of a `t.me/<bot>?start=` link).
 *
 * The code is consumed before anything is written so a replayed or forwarded
 * code can never link twice; an unexpected failure puts it back so a retry
 * can still complete.
 */
export const linkSenderByCode = async (params: {
  code: string;
  platform: MessengerPlatform;
  senderId: string;
  senderName?: string | null;
}): Promise<LinkByCodeOutcome> => {
  const payload = await consumeLinkCode(params.code, params.platform);
  if (!payload) return { status: 'invalid' };

  try {
    return await bindConsumedCode(payload, params);
  } catch (error) {
    await restoreLinkCode(params.code, payload).catch((restoreError: unknown) => {
      log('restoreLinkCode failed: %O', restoreError);
    });
    throw error;
  }
};

const bindConsumedCode = async (
  payload: LinkCodePayload,
  params: { platform: MessengerPlatform; senderId: string; senderName?: string | null },
): Promise<LinkByCodeOutcome> => {
  const serverDB = await getServerDB();
  const owner = await MessengerAccountLinkModel.findByPlatformUser(
    serverDB,
    params.platform,
    params.senderId,
    '',
  );
  if (owner && owner.userId !== payload.userId) {
    await settleLinkCode(payload.pollId, {
      reason: 'already_linked_to_other',
      status: 'failed',
    });
    return { status: 'already_linked_to_other' };
  }

  try {
    await new MessengerAccountLinkModel(serverDB, payload.userId).upsertForPlatform({
      activeAgentId: payload.activeAgentId,
      platform: params.platform,
      platformUserId: params.senderId,
      platformUsername: params.senderName ?? null,
      tenantId: '',
      workspaceId: payload.workspaceId,
    });
  } catch (error) {
    const reason =
      error instanceof MessengerAccountLinkConflictError
        ? ('already_linked_to_other' as const)
        : error instanceof MessengerAccountLinkRelinkRequiredError
          ? ('unlink_before_relink' as const)
          : undefined;
    if (!reason) throw error;
    await settleLinkCode(payload.pollId, { reason, status: 'failed' });
    return { status: reason };
  }

  // The link is committed. A failed poll-status write must not reach the
  // caller's restore path — that would resurrect a code for a sender who now
  // routes as linked, so the page would wait on it until expiry.
  try {
    await settleLinkCode(payload.pollId, {
      linkedAt: Date.now(),
      platformUserId: params.senderId,
      status: 'linked',
    });
  } catch (error) {
    log('settleLinkCode after link failed: %O', error);
  }
  log('linked %s sender for user=%s', params.platform, payload.userId);
  return { payload, status: 'linked' };
};
