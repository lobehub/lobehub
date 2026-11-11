import type { ChannelMemberMetadata, ChannelMemberWorktree } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import type { ChannelMemberItem } from '../../schemas';
import { channelJobs, channelMembers } from '../../schemas';
import type { Transaction } from '../../type';
import { audit } from './transaction';

/**
 * A conversation branch whose member directory is taken by another run moves into its own git
 * worktree instead of queueing. The worktree belongs to the (member, branch) pair, so later
 * replies in the same branch keep the same checkout and session; nothing is merged back.
 */

/** How long a directory that could not host a worktree is left alone before retrying. */
export const WORKTREE_RETRY_MS = 10 * 60 * 1000;

/** Key of a conversation branch: its Thread, or the main timeline. */
export const worktreeKey = (threadId: string | null) => threadId ?? 'main';

/** Git branch for the member's worktree; member ids are unique across all channels. */
export const worktreeBranch = (memberId: string, threadId: string | null) =>
  `lobe-channel/${memberId.replaceAll('-', '').slice(0, 12)}-${worktreeKey(threadId)}`;

/** The branch's worktree, while the member still runs in the directory it was cut from. */
export const assignedWorktree = (
  member: Pick<ChannelMemberItem, 'config' | 'metadata'>,
  threadId: string | null,
): ChannelMemberWorktree | undefined => {
  const { deviceId, workingDirectory } = member.config ?? {};
  const worktree = (member.metadata as ChannelMemberMetadata | null)?.worktrees?.[
    worktreeKey(threadId)
  ];
  if (
    worktree &&
    deviceId &&
    worktree.deviceId === deviceId &&
    worktree.sourceDirectory === workingDirectory
  )
    return worktree;
};

export interface ChannelWorktreeCandidate {
  branch: string;
  deviceId: string;
  /** Device calls route by the device owner, else the requester. */
  deviceUserId: string;
  memberId: string;
  sourceDirectory: string;
  threadId: string | null;
}

/**
 * A queued job held back only by another run in its member's directory, whose branch has no
 * worktree yet. The caller holds the channel lock.
 */
export const findWorktreeCandidate = async (
  tx: Transaction,
  channelId: string,
  jobId: string,
): Promise<ChannelWorktreeCandidate | undefined> => {
  const [row] = await tx
    .select({ job: channelJobs, member: channelMembers })
    .from(channelJobs)
    .innerJoin(channelMembers, eq(channelMembers.id, channelJobs.memberId))
    .where(
      and(
        eq(channelJobs.channelId, channelId),
        eq(channelJobs.id, jobId),
        eq(channelJobs.status, 'queued'),
        eq(channelJobs.blockedCode, 'directory_locked'),
        eq(channelMembers.status, 'active'),
      ),
    );
  if (!row) return;
  const { job, member } = row;
  const { deviceId, deviceOwnerId, workingDirectory } = member.config ?? {};
  if (!deviceId || !workingDirectory || assignedWorktree(member, job.threadId)) return;

  const unavailable = (member.metadata as ChannelMemberMetadata | null)?.worktreeUnavailable;
  if (
    unavailable?.deviceId === deviceId &&
    unavailable.sourceDirectory === workingDirectory &&
    Date.now() - new Date(unavailable.at).getTime() < WORKTREE_RETRY_MS
  )
    return;

  const [requester] = await tx
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(eq(channelMembers.id, job.requesterMemberId));
  const deviceUserId = deviceOwnerId ?? requester?.userId;
  if (!deviceUserId) return;

  return {
    branch: worktreeBranch(member.id, job.threadId),
    deviceId,
    deviceUserId,
    memberId: member.id,
    sourceDirectory: workingDirectory,
    threadId: job.threadId,
  };
};

/** Reads the member and checks it still runs where the worktree was cut from. */
const currentMember = async (
  tx: Transaction,
  channelId: string,
  candidate: Pick<ChannelWorktreeCandidate, 'deviceId' | 'memberId' | 'sourceDirectory'>,
) => {
  const [member] = await tx
    .select()
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.id, candidate.memberId)));
  if (
    member?.config?.deviceId !== candidate.deviceId ||
    member.config.workingDirectory !== candidate.sourceDirectory
  )
    return;
  return member;
};

/**
 * Records the branch's worktree. Returns false when the member's environment changed while
 * the device created it; that checkout is then simply unused.
 */
export const assignWorktree = async (
  tx: Transaction,
  channelId: string,
  candidate: ChannelWorktreeCandidate,
  path: string,
): Promise<boolean> => {
  const member = await currentMember(tx, channelId, candidate);
  if (!member) return false;
  const metadata = (member.metadata ?? {}) as ChannelMemberMetadata;
  const worktree: ChannelMemberWorktree = {
    branch: candidate.branch,
    deviceId: candidate.deviceId,
    path,
    sourceDirectory: candidate.sourceDirectory,
  };
  await tx
    .update(channelMembers)
    .set({
      metadata: {
        ...metadata,
        worktrees: { ...metadata.worktrees, [worktreeKey(candidate.threadId)]: worktree },
      },
    })
    .where(eq(channelMembers.id, member.id));
  await audit(tx, channelId, 'worktree_assigned', member.id, {
    branch: candidate.branch,
    threadId: candidate.threadId,
  });
  return true;
};

/** The directory could not host a worktree; the job keeps waiting for the directory. */
export const markWorktreeUnavailable = async (
  tx: Transaction,
  channelId: string,
  candidate: ChannelWorktreeCandidate,
  reason: string,
) => {
  const member = await currentMember(tx, channelId, candidate);
  if (!member) return;
  await tx
    .update(channelMembers)
    .set({
      metadata: {
        ...member.metadata,
        worktreeUnavailable: {
          at: new Date().toISOString(),
          deviceId: candidate.deviceId,
          sourceDirectory: candidate.sourceDirectory,
        },
      },
    })
    .where(eq(channelMembers.id, member.id));
  await audit(tx, channelId, 'worktree_unavailable', member.id, {
    reason: reason.slice(0, 500),
  });
};
