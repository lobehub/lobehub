import type {
  AgentAccessDecision,
  AgentAccessMissing,
  ChannelAgentAccessCard,
  ChannelAgentGrantStatus,
  ChannelSharedAgentAccess,
} from '@lobechat/types';
import { channelMessageAgentAccess } from '@lobechat/types';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { ChannelAgentGrantItem, ChannelItem, ChannelMessageItem } from '../../schemas';
import { agents, channelAgentGrants, channelMembers, channels, users } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { agentUsableByWhere } from '../../utils/agent-access';
import { findSharedChannelAgent } from './agent';
import { isAgentAuthored } from './author';
import { ChannelError } from './error';
import { audit, lockChannel } from './transaction';

/** Request key of an access request's card in the owner's direct conversation with the Agent. */
export const agentAccessCardKey = (grantId: string) => `agent-access:${grantId}`;

/** What a grant row's `metadata` holds for an access request. */
interface AccessRequestMetadata {
  /** Failed replies to run again once the owner decides (a refused CLI device, a declined ask). */
  jobIds?: string[];
  missing?: AgentAccessMissing[];
}

type AccessGrant = Pick<ChannelAgentGrantItem, 'createdAt' | 'decidedAt' | 'id' | 'status'>;

/**
 * How a requester may use an Agent member of a Channel, decided from the database alone (the
 * device half of a share's grant needs the server; see `resolveAgentAccess`):
 *
 * - `own`: they can use it as their own, or as their workspace's.
 * - `share`: another person's Agent whose live share admits them (`agentShareAdmits`), in their
 *   direct conversation with it, or in a group whose owner allowed them (an approved grant).
 * - `request`: its owner can let them: `grant` is their latest request (pending, declined, or an
 *   approval the share no longer honours), and `missing` what approving grants.
 * - `unavailable`: nobody can (gone, trashed, or theirs in another scope).
 */
export type ChannelAgentAccess =
  | { kind: 'own' }
  | { kind: 'share'; share: NonNullable<Awaited<ReturnType<typeof findSharedChannelAgent>>> }
  | { grant?: AccessGrant; kind: 'request'; missing: AgentAccessMissing[]; ownerId: string }
  | { kind: 'unavailable' };

/**
 * The grant covering a requester in a Channel: an approval for them (or for everyone, in this
 * Thread or all of them) wins; otherwise their own latest request, pending or decided. A pending
 * or declined request only ever names one person.
 */
const coveringGrant = async (
  db: LobeChatDatabase | Transaction,
  memberId: string,
  requesterMemberId: string,
  threadId: string | null,
): Promise<AccessGrant | undefined> => {
  const rows = await db
    .select({
      createdAt: channelAgentGrants.createdAt,
      decidedAt: channelAgentGrants.decidedAt,
      granteeMemberId: channelAgentGrants.granteeMemberId,
      id: channelAgentGrants.id,
      status: channelAgentGrants.status,
    })
    .from(channelAgentGrants)
    .where(
      and(
        eq(channelAgentGrants.memberId, memberId),
        or(
          eq(channelAgentGrants.granteeMemberId, requesterMemberId),
          isNull(channelAgentGrants.granteeMemberId),
        ),
        threadId
          ? or(eq(channelAgentGrants.threadId, threadId), isNull(channelAgentGrants.threadId))
          : isNull(channelAgentGrants.threadId),
        inArray(channelAgentGrants.status, ['approved', 'pending', 'rejected']),
      ),
    )
    .orderBy(desc(channelAgentGrants.createdAt))
    .limit(20);
  const approved = rows.find((row) => row.status === 'approved');
  const own = approved ?? rows.find((row) => row.granteeMemberId === requesterMemberId);
  return (
    own && { createdAt: own.createdAt, decidedAt: own.decidedAt, id: own.id, status: own.status }
  );
};

/**
 * See {@link ChannelAgentAccess}. `requester.memberId` is their member in this Channel; without one
 * (asked from outside it) no request of theirs is read.
 */
export const resolveChannelAgentAccess = async (
  db: LobeChatDatabase | Transaction,
  channel: Pick<ChannelItem, 'agentId' | 'workspaceId'>,
  agentMember: { agentId: string | null; id: string },
  requester: { memberId?: string; userId: string },
  threadId: string | null = null,
): Promise<ChannelAgentAccess> => {
  const { agentId } = agentMember;
  if (!agentId) return { kind: 'unavailable' };
  const [usable] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      agentUsableByWhere(agentId, {
        userId: requester.userId,
        workspaceId: channel.workspaceId ?? undefined,
      }),
    );
  if (usable) return { kind: 'own' };

  const [agent] = await db
    .select({ isDeleted: agents.isDeleted, ownerId: agents.userId })
    .from(agents)
    .where(eq(agents.id, agentId));
  if (!agent?.ownerId || agent.isDeleted === true || agent.ownerId === requester.userId)
    return { kind: 'unavailable' };

  const grant = requester.memberId
    ? await coveringGrant(db, agentMember.id, requester.memberId, threadId)
    : undefined;
  const direct = channel.agentId === agentId;
  const share = await findSharedChannelAgent(db, requester.userId, agentId);
  const missing: AgentAccessMissing[] = [];
  if (!share) missing.push('share');
  if (!direct && grant?.status !== 'approved') missing.push('channel');
  // Asked, or declined: the owner's answer stands until they decide, or the requester asks again.
  if (grant?.status === 'pending' || grant?.status === 'rejected')
    return { grant, kind: 'request', missing, ownerId: agent.ownerId };
  if (share && (direct || grant?.status === 'approved')) return { kind: 'share', share };
  return { grant, kind: 'request', missing, ownerId: agent.ownerId };
};

/** The share part of {@link ChannelAgentAccess}, for callers that only run what it admits. */
export const accessShare = (access: ChannelAgentAccess): ChannelSharedAgentAccess | undefined =>
  access.kind === 'share'
    ? {
        ownerId: access.share.ownerId,
        shareId: access.share.shareId,
        workspaceId: access.share.workspaceId,
      }
    : undefined;

/**
 * Files the requester's request to use an Agent member with its owner, or returns the one they
 * already have waiting: one live request per person and Agent member (the grants' unique scope).
 * An approval the share no longer honours (the owner revoked the share grant or paused the share)
 * is retired as revoked first, so asking again reaches the owner. `jobId` is a failed reply to run
 * again once the owner decides. Called under the channel lock.
 */
export const fileAgentAccessRequest = async (
  tx: Transaction,
  channelId: string,
  params: {
    jobId?: string;
    memberId: string;
    missing: AgentAccessMissing[];
    ownerId: string;
    requesterMemberId: string;
  },
): Promise<{ created: boolean; grant: ChannelAgentGrantItem }> => {
  const now = new Date();
  await tx
    .update(channelAgentGrants)
    .set({ revokeReason: 'revoked_by_owner', revokedAt: now, status: 'revoked', updatedAt: now })
    .where(
      and(
        eq(channelAgentGrants.memberId, params.memberId),
        eq(channelAgentGrants.granteeMemberId, params.requesterMemberId),
        isNull(channelAgentGrants.threadId),
        eq(channelAgentGrants.status, 'approved'),
      ),
    );
  const metadata: AccessRequestMetadata = {
    jobIds: params.jobId ? [params.jobId] : [],
    missing: params.missing,
  };
  const [created] = await tx
    .insert(channelAgentGrants)
    .values({
      channelId,
      granteeMemberId: params.requesterMemberId,
      memberId: params.memberId,
      metadata: metadata as Record<string, unknown>,
      ownerId: params.ownerId,
      requestedByMemberId: params.requesterMemberId,
      status: 'pending',
    })
    .onConflictDoNothing()
    .returning();
  if (created) {
    await audit(tx, channelId, 'agent_access_requested', created.id, {
      missing: params.missing,
    });
    return { created: true, grant: created };
  }

  const [live] = await tx
    .select()
    .from(channelAgentGrants)
    .where(
      and(
        eq(channelAgentGrants.memberId, params.memberId),
        eq(channelAgentGrants.granteeMemberId, params.requesterMemberId),
        isNull(channelAgentGrants.threadId),
        eq(channelAgentGrants.status, 'pending'),
      ),
    );
  if (!live) throw new ChannelError('CONFLICT', 'The access request could not be filed');
  const known = live.metadata as AccessRequestMetadata | null;
  const jobIds = [...new Set([...(known?.jobIds ?? []), ...(params.jobId ? [params.jobId] : [])])];
  const missing = [...new Set([...(known?.missing ?? []), ...params.missing])];
  const [updated] = await tx
    .update(channelAgentGrants)
    .set({ metadata: { ...known, jobIds, missing }, updatedAt: now })
    .where(eq(channelAgentGrants.id, live.id))
    .returning();
  return { created: false, grant: updated };
};

/** The failed replies a request asked to run again, and what it asked for. */
export const accessRequestMetadata = (grant: Pick<ChannelAgentGrantItem, 'metadata'>) => {
  const metadata = (grant.metadata ?? {}) as AccessRequestMetadata;
  return { jobIds: metadata.jobIds ?? [], missing: metadata.missing ?? [] };
};

const NEXT_STATUS: Record<AgentAccessDecision, ChannelAgentGrantStatus> = {
  approve: 'approved',
  deny: 'rejected',
};

/**
 * Records the Agent owner's decision on an access request, under the channel lock. Only the owner
 * named on it decides, and only while the Agent is still theirs. Idempotent: the same decision
 * again returns the grant unchanged (`changed: false`); a different one on a decided request is a
 * conflict. The share half of an approval is the caller's (`approveAgentAccess`), done first.
 */
export const decideAgentAccessGrant = async (
  db: LobeChatDatabase,
  userId: string,
  grantId: string,
  decision: AgentAccessDecision,
): Promise<{ changed: boolean; grant: ChannelAgentGrantItem }> => {
  const [found] = await db
    .select({ channelId: channelAgentGrants.channelId })
    .from(channelAgentGrants)
    .where(eq(channelAgentGrants.id, grantId));
  if (!found) throw new ChannelError('NOT_FOUND', 'Access request not found');

  return db.transaction(async (tx) => {
    await lockChannel(tx, found.channelId);
    const [grant] = await tx
      .select()
      .from(channelAgentGrants)
      .where(eq(channelAgentGrants.id, grantId));
    if (!grant || grant.ownerId !== userId)
      throw new ChannelError('NOT_FOUND', 'Access request not found');

    const to = NEXT_STATUS[decision];
    if (grant.status === to) return { changed: false, grant };
    if (grant.status !== 'pending')
      throw new ChannelError('CONFLICT', `A ${grant.status} request cannot be changed that way`);

    const now = new Date();
    const [updated] = await tx
      .update(channelAgentGrants)
      .set({ decidedAt: now, status: to, updatedAt: now })
      .where(eq(channelAgentGrants.id, grantId))
      .returning();
    await audit(tx, grant.channelId, `agent_access_${to}`, grant.id);
    return { changed: true, grant: updated };
  });
};

/** A request with what its decision and card need: the Agent, its owner and the requester. */
export const findAgentAccessRequest = async (db: LobeChatDatabase, grantId: string) => {
  const grantees = alias(channelMembers, 'access_grantees');
  const [row] = await db
    .select({
      agentId: channelMembers.agentId,
      agentMemberStatus: channelMembers.status,
      agentWorkspaceId: agents.workspaceId,
      grant: channelAgentGrants,
      ownerId: agents.userId,
      requesterStatus: grantees.status,
      requesterUserId: grantees.userId,
    })
    .from(channelAgentGrants)
    .innerJoin(channelMembers, eq(channelMembers.id, channelAgentGrants.memberId))
    .innerJoin(agents, eq(agents.id, channelMembers.agentId))
    .leftJoin(grantees, eq(grantees.id, channelAgentGrants.granteeMemberId))
    .where(eq(channelAgentGrants.id, grantId));
  return row;
};

/**
 * The requester's latest request to use an Agent: in one Channel when given, else in any. For the
 * client to show where their ask stands before they send.
 */
export const latestAgentAccessRequest = async (
  db: LobeChatDatabase,
  params: { agentId: string; channelId?: string; requesterUserId: string },
) => {
  const agentMembers = alias(channelMembers, 'access_agent_members');
  const grantees = alias(channelMembers, 'access_request_grantees');
  const [row] = await db
    .select({
      channelId: channelAgentGrants.channelId,
      createdAt: channelAgentGrants.createdAt,
      decidedAt: channelAgentGrants.decidedAt,
      id: channelAgentGrants.id,
      metadata: channelAgentGrants.metadata,
      status: channelAgentGrants.status,
    })
    .from(channelAgentGrants)
    .innerJoin(agentMembers, eq(agentMembers.id, channelAgentGrants.memberId))
    .innerJoin(grantees, eq(grantees.id, channelAgentGrants.granteeMemberId))
    .where(
      and(
        eq(agentMembers.agentId, params.agentId),
        eq(grantees.userId, params.requesterUserId),
        params.channelId ? eq(channelAgentGrants.channelId, params.channelId) : undefined,
        inArray(channelAgentGrants.status, ['approved', 'pending', 'rejected']),
      ),
    )
    .orderBy(desc(channelAgentGrants.createdAt))
    .limit(1);
  return row;
};

const requesterMembers = alias(channelMembers, 'access_card_requesters');
const requesterUsers = alias(users, 'access_card_requester_users');

/** Pending requests in one Channel, with what their cards are written from. */
export const pendingAgentAccessRequests = (db: LobeChatDatabase, channelId: string) =>
  db
    .select({
      agentId: channelMembers.agentId,
      agentName: channelMembers.name,
      agentWorkspaceId: agents.workspaceId,
      channelId: channelAgentGrants.channelId,
      channelTitle: channels.title,
      grantId: channelAgentGrants.id,
      metadata: channelAgentGrants.metadata,
      ownerId: channelAgentGrants.ownerId,
      requesterName: sql<
        string | null
      >`coalesce(${requesterUsers.fullName}, ${requesterUsers.username})`,
      requesterUserId: requesterMembers.userId,
    })
    .from(channelAgentGrants)
    .innerJoin(channels, eq(channels.id, channelAgentGrants.channelId))
    .innerJoin(channelMembers, eq(channelMembers.id, channelAgentGrants.memberId))
    .innerJoin(agents, eq(agents.id, channelMembers.agentId))
    .leftJoin(requesterMembers, eq(requesterMembers.id, channelAgentGrants.requestedByMemberId))
    .leftJoin(requesterUsers, eq(requesterUsers.id, requesterMembers.userId))
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelAgentGrants.status, 'pending'),
        eq(channelMembers.status, 'active'),
      ),
    );

/**
 * The current status of the access requests an Agent's cards on this page carry, for the Agent
 * owner reading them. A request that is gone reads as `expired`; a card the viewer does not own
 * reads as nothing.
 */
export const agentAccessCards = async (
  tx: Transaction,
  rows: Pick<ChannelMessageItem, 'agentId' | 'id' | 'metadata' | 'routingStatus'>[],
  viewerUserId: string | undefined,
) => {
  const requests = rows.flatMap((row) => {
    const request = isAgentAuthored(row) && channelMessageAgentAccess(row.metadata);
    return request ? [[row.id, request] as const] : [];
  });
  const cards = new Map<string, ChannelAgentAccessCard>();
  if (!viewerUserId || !requests.length) return cards;
  const found = await tx
    .select({
      id: channelAgentGrants.id,
      ownerId: channelAgentGrants.ownerId,
      status: channelAgentGrants.status,
    })
    .from(channelAgentGrants)
    .where(
      inArray(
        channelAgentGrants.id,
        requests.map(([, request]) => request.grantId),
      ),
    );
  const grants = new Map(found.map((grant) => [grant.id, grant]));
  for (const [messageId, request] of requests) {
    const grant = grants.get(request.grantId);
    if (grant && grant.ownerId !== viewerUserId) continue;
    cards.set(messageId, { ...request, status: grant?.status ?? 'expired' });
  }
  return cards;
};
