import { AGENT_SHARE_DEVICE_ALLOW_USERS_LIMIT } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { AgentAccessDecision } from '@lobechat/types';
import { isLiveAgentShareVisibility } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { AgentShareModel } from '@/database/models/agentShare';
import { ChannelError } from '@/database/repositories/channel';
import {
  accessRequestMetadata,
  decideAgentAccessGrant,
  fileAgentAccessRequest,
  findAgentAccessRequest,
} from '@/database/repositories/channel/agentAccess';
import { retryJob } from '@/database/repositories/channel/retry';
import { withChannelLock } from '@/database/repositories/channel/transaction';
import { channelJobs, channelMembers } from '@/database/schemas';
import { AgentService } from '@/server/services/agent';

import { notifyChannel } from '../notify';
import { wakeChannel } from '../queue';
import { announceAgentAccessRequests, refreshAgentAccessCard } from './card';
import { evaluateShareAccess, resolveAgentAccess } from './resolve';

export interface RequestAgentAccessInput {
  agentId: string;
  channelId: string;
  /** A failed reply of the requester's (its card's `jobId`) to run again once the owner decides. */
  jobId?: string;
}

/**
 * Asking an Agent's owner to let someone use it, and the owner's answer. The requester asks from a
 * Channel they are in (a group, or their own conversation with the Agent); the owner decides on
 * the card posted in their conversation with the Agent (`announceAgentAccessRequests`).
 */
export class AgentAccessService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  /** Whether the caller may use the Agent, for the client entering its conversation or profile. */
  check = (input: { agentId: string; channelId?: string }) =>
    resolveAgentAccess(this.db, {
      ...input,
      requesterUserId: this.userId,
      workspaceId: this.workspaceId ?? null,
    });

  /**
   * Files the caller's request with the Agent's owner and posts its card; asking again while one
   * waits only adds `jobId` to it. Refused when the caller can already use the Agent or nobody can
   * grant it.
   */
  request = async ({ agentId, channelId, jobId }: RequestAgentAccessInput) => {
    const access = await this.check({ agentId, channelId });
    if (access.state === 'unavailable' || !access.ownerId)
      throw new ChannelError('NOT_FOUND', 'Agent not found');
    if (access.state === 'ok') throw new ChannelError('CONFLICT', 'You can already use this Agent');

    await withChannelLock(this.db, channelId, async (tx) => {
      const members = await tx
        .select({
          agentId: channelMembers.agentId,
          id: channelMembers.id,
          userId: channelMembers.userId,
        })
        .from(channelMembers)
        .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.status, 'active')));
      const requester = members.find((member) => member.userId === this.userId);
      const agentMember = members.find((member) => member.agentId === agentId);
      if (!requester || !agentMember) throw new ChannelError('NOT_FOUND', 'Agent not found');
      if (jobId) {
        const [job] = await tx
          .select({ status: channelJobs.status })
          .from(channelJobs)
          .where(
            and(
              eq(channelJobs.channelId, channelId),
              eq(channelJobs.id, jobId),
              eq(channelJobs.memberId, agentMember.id),
              eq(channelJobs.requesterMemberId, requester.id),
            ),
          );
        if (job?.status !== 'failed') throw new ChannelError('NOT_FOUND', 'Reply not found');
      }
      await fileAgentAccessRequest(tx, channelId, {
        jobId,
        memberId: agentMember.id,
        missing: access.missing,
        ownerId: access.ownerId!,
        requesterMemberId: requester.id,
      });
    });
    await announceAgentAccessRequests(this.db, channelId);
    await notifyChannel(this.db, channelId);
    return this.check({ agentId, channelId });
  };

  /**
   * The owner's answer, idempotent. Approving first grants what the request lacks (see
   * {@link grantAgentAccess}); then either answer runs the replies it holds again: queued ones
   * wake with the Channel, failed ones it named go back to the queue, where an approved requester
   * runs and a declined one settles with the owner's refusal on its card.
   */
  decide = async (grantId: string, decision: AgentAccessDecision) => {
    const row = await findAgentAccessRequest(this.db, grantId);
    if (!row?.agentId || row.grant.ownerId !== this.userId || row.ownerId !== this.userId)
      throw new ChannelError('NOT_FOUND', 'Access request not found');
    if (decision === 'approve' && ['approved', 'pending'].includes(row.grant.status)) {
      // Fail closed: the approval rests on the Agent being pulled into this Channel and the
      // requester still being in it, which is what lets it skip the share-creation gate.
      if (row.agentMemberStatus !== 'active')
        throw new ChannelError('CONFLICT', 'The Agent is no longer in this Channel');
      if (!row.requesterUserId || row.requesterStatus !== 'active')
        throw new ChannelError('CONFLICT', 'The requester is no longer in this Channel');
      await grantAgentAccess(this.db, {
        agentId: row.agentId,
        channelId: row.grant.channelId,
        grantId,
        ownerId: this.userId,
        requesterUserId: row.requesterUserId,
        workspaceId: row.agentWorkspaceId,
      });
    }

    const { changed, grant } = await decideAgentAccessGrant(
      this.db,
      this.userId,
      grantId,
      decision,
    );
    if (changed) {
      const { jobIds } = accessRequestMetadata(grant);
      if (jobIds.length)
        await withChannelLock(this.db, grant.channelId, async (tx) => {
          for (const jobId of jobIds)
            await retryJob(tx, grant.channelId, jobId).catch(() => undefined);
        });
      await wakeChannel(grant.channelId);
      await notifyChannel(this.db, grant.channelId);
    }
    await refreshAgentAccessCard(this.db, {
      agentId: row.agentId,
      id: grant.id,
      ownerId: this.userId,
    });
    return { grant: { id: grant.id, status: grant.status } };
  };
}

/**
 * The share half of approving a request: what the requester lacked, granted on the Agent's share
 * so every surface (the share page, a direct conversation, the group it was asked in) reads it
 * alike. A share that admits nobody else is created, or resumed, as `card`, which admits only the
 * people its owner granted; a live one keeps its visibility. The requester holds a request grant
 * (`AgentShareModel.grantByRequest`). A local CLI Agent also lists them for its device
 * (`deviceAllowUserIds`, with `deviceAccess` at least `allowlist`), which their request grant
 * admits without being in the owner's address book (`resolveShareVisitorDeviceAccess`).
 * Idempotent.
 *
 * Neither the share-creation feature gate (`assertAgentShareCreationEnabled`) nor the share
 * model restriction (`AgentService.prepareShareModel`, `AGENT_SHARE_ALLOWED_PROVIDERS`) applies:
 * both guard a person publishing a share from share settings. Here the owner already pulled the
 * Agent into the Channel and approves one person there, and the share row is only how that grant
 * is recorded; the run path checks neither. Only called for an Agent that is an active member of
 * the request's Channel (`decide`).
 */
export const grantAgentAccess = async (
  db: LobeChatDatabase,
  params: {
    agentId: string;
    channelId: string;
    grantId: string;
    ownerId: string;
    requesterUserId: string;
    workspaceId: string | null;
  },
) => {
  const { agentId, ownerId, requesterUserId } = params;
  const agentService = new AgentService(db, ownerId, params.workspaceId ?? undefined);
  const shareId = await agentService.withShareModelLock(agentId, async (_service, shares) => {
    let share = await shares.getByAgentId(agentId);
    if (!share || !isLiveAgentShareVisibility(share.visibility)) {
      const created = await shares.create(agentId, 'card');
      share =
        created.visibility === 'private'
          ? await shares.updateVisibility(agentId, 'card')
          : await shares.getByAgentId(agentId);
    }
    if (!share) throw new ChannelError('NOT_FOUND', 'Agent share not found');
    return share.id;
  });
  await AgentShareModel.grantByRequest(db, {
    channelId: params.channelId,
    grantId: params.grantId,
    shareId,
    userId: requesterUserId,
  });

  const share = await AgentShareModel.findByShareId(db, shareId);
  if (!share) throw new ChannelError('NOT_FOUND', 'Agent share not found');
  const access = await evaluateShareAccess(db, share, requesterUserId);
  if (!access.local || access.canUseDevice) return;

  const { deviceAccess, deviceAllowUserIds = [] } = share.shareConfig;
  if (
    !deviceAllowUserIds.includes(requesterUserId) &&
    deviceAllowUserIds.length >= AGENT_SHARE_DEVICE_ALLOW_USERS_LIMIT
  )
    throw new ChannelError('CONFLICT', 'The Agent’s device already allows the most people it can');
  await new AgentShareModel(db, ownerId, params.workspaceId ?? undefined).updateConfig(agentId, {
    // `contacts` keeps admitting the address book; the list then names the people outside it.
    deviceAccess: deviceAccess === 'contacts' ? 'contacts' : 'allowlist',
    deviceAllowUserIds: [...new Set([...deviceAllowUserIds, requesterUserId])],
  });
  const updated = await AgentShareModel.findByShareId(db, shareId);
  // Device grants need Channels on for the owner; refuse instead of approving what cannot run.
  if (!updated || !(await evaluateShareAccess(db, updated, requesterUserId)).canUseDevice)
    throw new ChannelError('FORBIDDEN', 'Device access is not available for this Agent');
};
