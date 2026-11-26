import type { LobeChatDatabase } from '@lobechat/database';
import type { ChannelAgentAccessRequest } from '@lobechat/types';
import { agentAccessRequestText } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';
import pMap from 'p-map';

import { ChannelRepository } from '@/database/repositories/channel';
import {
  accessRequestMetadata,
  agentAccessCardKey,
  pendingAgentAccessRequests,
} from '@/database/repositories/channel/agentAccess';
import { channelMessages, channels } from '@/database/schemas';

import { ChannelService } from '../ChannelService';
import { notifyChannel } from '../notify';
import { resolveAgentAccess } from './resolve';

type CardGrant = { agentId: string; id: string; ownerId: string };

/** The owner's direct conversations with the Agent that hold this request's card. */
const cardChannels = (db: LobeChatDatabase, grant: CardGrant) =>
  db
    .select({ channelId: channelMessages.channelId })
    .from(channels)
    .innerJoin(
      channelMessages,
      and(
        eq(channelMessages.channelId, channels.id),
        eq(channelMessages.requestKey, agentAccessCardKey(grant.id)),
      ),
    )
    .where(and(eq(channels.agentId, grant.agentId), eq(channels.userId, grant.ownerId)));

/**
 * Asks the owner of each Agent someone in this Channel may not use, as that Agent: one card per
 * request in the owner's direct conversation with it, which they approve or deny in place.
 *
 * Owner-only by where it lives, not by a per-viewer filter: the request is made in a group (or the
 * requester's own conversation with the Agent), but a card there would be read, counted unread and
 * searched by everyone in it. Every Channel read path (view, history, search, unread and mention
 * counts, the last-message preview, the run's own context) reads one shared timeline, so hiding a
 * message from all but one reader would have to be added to each of them. The requester's reply
 * in the group waits meanwhile, as `access_request_pending`.
 *
 * Idempotent per request, so callers run it after anything that may file one. Best-effort: an
 * owner who cannot open a conversation with the Agent still decides from the request API.
 */
export const announceAgentAccessRequests = async (db: LobeChatDatabase, channelId: string) => {
  try {
    const rows = await pendingAgentAccessRequests(db, channelId);
    for (const { agentId, agentWorkspaceId, metadata, ownerId, ...request } of rows) {
      if (!agentId) continue;
      try {
        const grant = { agentId, id: request.grantId, ownerId };
        if ((await cardChannels(db, grant)).length) continue;
        // The owner's conversation with their Agent lives in the Agent's own scope.
        const scope = agentWorkspaceId ?? undefined;
        const direct = await new ChannelService(db, ownerId, scope).openDirect(agentId);
        if (!direct) continue;
        // What approving grants, as of now: the claim that filed it cannot see the device half.
        const access = request.requesterUserId
          ? await resolveAgentAccess(db, {
              agentId,
              channelId,
              requesterUserId: request.requesterUserId,
            })
          : undefined;
        const missing = [
          ...new Set([...accessRequestMetadata({ metadata }).missing, ...(access?.missing ?? [])]),
        ];
        const card: ChannelAgentAccessRequest = { ...request, agentId, missing };
        await new ChannelRepository(db, ownerId, scope).postAgentMessage(direct.channel.id, {
          agentId,
          content: agentAccessRequestText(card),
          kind: 'agentAccess',
          metadata: { agentAccess: card },
          requestKey: agentAccessCardKey(request.grantId),
        });
        await notifyChannel(db, direct.channel.id);
      } catch (error) {
        console.error('[channel] Failed to post an access request card', {
          channelId,
          error,
          grantId: request.grantId,
        });
      }
    }
  } catch (error) {
    console.error('[channel] Failed to read access requests', { channelId, error });
  }
};

/** Refreshes the owner's conversations holding this request's card, so it shows the decision. */
export const refreshAgentAccessCard = async (db: LobeChatDatabase, grant: CardGrant) => {
  try {
    const cards = await cardChannels(db, grant);
    await pMap(cards, (card) => notifyChannel(db, card.channelId), { concurrency: 5 });
  } catch (error) {
    console.error('[channel] Failed to refresh an access request card', {
      error,
      grantId: grant.id,
    });
  }
};
