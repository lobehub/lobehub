import type { LobeChatDatabase } from '@lobechat/database';
import type { ChannelDeviceGrantRequest } from '@lobechat/types';
import { deviceGrantRequestText } from '@lobechat/types';
import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import pMap from 'p-map';

import { ChannelRepository } from '@/database/repositories/channel';
import {
  channelMemberGrants,
  channelMembers,
  channelMessages,
  channels,
  devices,
  users,
} from '@/database/schemas';

import { ChannelService } from './ChannelService';
import { notifyChannel } from './notify';

/** Request key of a grant's card in its device owner's direct conversation. */
export const deviceGrantCardKey = (grantId: string) => `device-grant:${grantId}`;

const requesters = alias(channelMembers, 'card_requesters');
const requesterUsers = alias(users, 'card_requester_users');

/** Pending requests in one Channel, with what their cards are written from. */
const pendingRequests = (db: LobeChatDatabase, channelId: string) =>
  db
    .select({
      agentId: channelMembers.agentId,
      agentName: channelMembers.name,
      channelId: channelMemberGrants.channelId,
      channelTitle: channels.title,
      deviceId: channelMemberGrants.deviceId,
      deviceName: sql<
        string | null
      >`coalesce(nullif(${devices.friendlyName}, ''), ${devices.hostname})`,
      deviceOwnerId: channelMemberGrants.deviceOwnerId,
      grantId: channelMemberGrants.id,
      memberId: channelMemberGrants.memberId,
      requesterName: sql<
        string | null
      >`coalesce(${requesterUsers.fullName}, ${requesterUsers.username})`,
      requesterUserId: requesters.userId,
      workingDirectory: channelMemberGrants.workingDirectory,
      workspaceId: channels.workspaceId,
    })
    .from(channelMemberGrants)
    .innerJoin(channels, eq(channels.id, channelMemberGrants.channelId))
    .innerJoin(channelMembers, eq(channelMembers.id, channelMemberGrants.memberId))
    .leftJoin(requesters, eq(requesters.id, channelMemberGrants.requestedByMemberId))
    .leftJoin(requesterUsers, eq(requesterUsers.id, requesters.userId))
    .leftJoin(
      devices,
      and(
        eq(devices.deviceId, channelMemberGrants.deviceId),
        eq(devices.workspaceId, channels.workspaceId),
      ),
    )
    .where(
      and(
        // Filters on the member, whose Channel is indexed; the grant joins by its unique member.
        eq(channelMembers.channelId, channelId),
        eq(channelMemberGrants.status, 'pending'),
        eq(channelMembers.status, 'active'),
      ),
    );

type CardGrant = { deviceOwnerId: string; id: string; memberId: string };

/** The device owner's direct conversations with the member's Agent that hold this grant's card. */
const cardChannels = (db: LobeChatDatabase, grant: CardGrant) =>
  db
    .select({ channelId: channelMessages.channelId })
    .from(channelMembers)
    .innerJoin(
      channels,
      and(eq(channels.agentId, channelMembers.agentId), eq(channels.userId, grant.deviceOwnerId)),
    )
    .innerJoin(
      channelMessages,
      and(
        eq(channelMessages.channelId, channels.id),
        eq(channelMessages.requestKey, deviceGrantCardKey(grant.id)),
      ),
    )
    .where(eq(channelMembers.id, grant.memberId));

/**
 * Asks each device owner with a pending request in this Channel, as the Agent that would run
 * there: one card per request in the owner's direct conversation with that Agent, which they
 * approve or reject in place. Idempotent per request, so callers run it after anything that may
 * file one. Best-effort: an owner who cannot open a conversation with the Agent (no access, or
 * moved it to the trash) still decides in the Channel or in device settings.
 */
export const announceDeviceGrants = async (db: LobeChatDatabase, channelId: string) => {
  try {
    const rows = await pendingRequests(db, channelId);
    for (const { agentId, deviceOwnerId, memberId, workspaceId, ...request } of rows) {
      if (!agentId) continue;
      try {
        const grant = { deviceOwnerId, id: request.grantId, memberId };
        if ((await cardChannels(db, grant)).length) continue;
        const scope = workspaceId ?? undefined;
        const direct = await new ChannelService(db, deviceOwnerId, scope).openDirect(agentId);
        if (!direct) continue;
        const card: ChannelDeviceGrantRequest = request;
        await new ChannelRepository(db, deviceOwnerId, scope).postAgentMessage(direct.channel.id, {
          agentId,
          content: deviceGrantRequestText(card),
          kind: 'deviceGrant',
          metadata: { deviceGrant: card },
          requestKey: deviceGrantCardKey(request.grantId),
        });
        await notifyChannel(db, direct.channel.id);
      } catch (error) {
        console.error('[channel] Failed to post a device request card', {
          channelId,
          error,
          grantId: request.grantId,
        });
      }
    }
  } catch (error) {
    console.error('[channel] Failed to read device requests', { channelId, error });
  }
};

/**
 * Refreshes the device owner's conversations holding this grant's card, so its status follows a
 * decision made anywhere: on the card, in the Channel, or in device settings.
 */
export const refreshDeviceGrantCard = async (db: LobeChatDatabase, grant: CardGrant) => {
  try {
    const cards = await cardChannels(db, grant);
    await pMap(cards, (card) => notifyChannel(db, card.channelId), { concurrency: 5 });
  } catch (error) {
    console.error('[channel] Failed to refresh a device request card', {
      error,
      grantId: grant.id,
    });
  }
};
