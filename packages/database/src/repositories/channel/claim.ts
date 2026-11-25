import type { ChannelExecutionConfig, ChannelJobBlockCode, LobeAgentConfig } from '@lobechat/types';
import { channelMessageDeletedAt } from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { PartialDeep } from 'type-fest';

import type {
  ChannelItem,
  ChannelJobItem,
  ChannelMemberItem,
  ChannelMessageItem,
  ChannelThreadItem,
  TopicItem,
} from '../../schemas';
import {
  agentOperations,
  channelJobs,
  channelMemberGrants,
  channelMembers,
  channelMessages,
  devices,
} from '../../schemas';
import type { Transaction } from '../../type';
import { createNanoId } from '../../utils/idGenerator';
import { resolveExecutionConfig } from './agent';
import { fileAgentAccessRequest, resolveChannelAgentAccess } from './agentAccess';
import { AWAITING_PRIMARY_REASON, findThread } from './delivery';
import { requestMissingGrant } from './grants';
import { buildManifest } from './manifest';
import { findMergeableRequests, mergeJobs } from './merge';
import type { ChannelTopicScope } from './topic';
import { continuationTopic, resolveTopic, resumableTopic } from './topic';
import { audit } from './transaction';
import { assignedWorktree, sharesDirectory } from './worktree';

export interface ChannelClaimOptions {
  /** How long the claimer may go without a heartbeat before reconcile takes over. */
  leaseMs: number;
  /** Process or queue worker that will drive the run. */
  leaseOwner: string;
  /**
   * Called when the claim settled the job as failed because the Agent's owner declined its
   * requester, so the caller posts its card once the claim commits.
   */
  onAccessDenied?: (jobId: string) => void;
  /** Trusted presence snapshot from the current Gateway scope; omitted by storage-only callers. */
  onlineDeviceIds?: string[];
  /**
   * The device a run with no device picked in the Channel will route to, from the Agent's own
   * settings as the execution identity's ordinary conversation would resolve them, and whether it
   * is online for that identity; undefined when it needs none or would wake it. Lets an offline
   * Agent-bound device wait like a Channel one. Its presence is that identity's, which may
   * include a personal device, so it stays out of `onlineDeviceIds`. Only consulted with
   * `onlineDeviceIds`.
   */
  routedDevice?: (run: ChannelRoutedDeviceInput) => Promise<ChannelRoutedDevice | undefined>;
  /** Trusted server defaults from getServerDefaultAgentConfig(); use {} when unconfigured. */
  serverDefaultAgentConfig: PartialDeep<LobeAgentConfig>;
}

export interface ChannelRoutedDevice {
  deviceId: string;
  online: boolean;
}

export interface ChannelRoutedDeviceInput {
  agentId: string;
  /**
   * The topic this run will continue, if any. A conversation stays on the device it ran on, so
   * its pin can outrank the Agent's binding.
   */
  continuation?: Pick<TopicItem, 'agentId' | 'groupId' | 'metadata' | 'projectWorkingDirectoryId'>;
  executionConfig: ChannelExecutionConfig;
  /**
   * The execution identity, with its device preference for the Agent: the requester, or a shared
   * Agent's owner, whose device the visitor's run uses.
   */
  userId: string;
  /** The run's scope: the Channel's, or a shared Agent's owner scope. */
  workspaceId: string | null;
}

export interface ChannelClaim {
  /** The claimed job, with its reserved `operationId` and frozen `manifest`. */
  job: ChannelJobItem;
  member: ChannelMemberItem;
  /** Ordinary Agent topic, reused when safe; also the operation's `topicId`. */
  topic: TopicItem;
}

/** Jobs in the same conversation branch: one Thread, or the main timeline. */
export const sameBranch = (threadId: string | null) =>
  threadId ? eq(channelJobs.threadId, threadId) : isNull(channelJobs.threadId);

/**
 * Records why a queued job cannot start; clients read the code, never the text. A job waiting
 * for a device also records which one in `deviceId`, so it can be shown before any claim sets
 * it. Only a claim gives a job its writer, so a queued job's device holds no directory.
 */
const block = async (
  tx: Transaction,
  job: ChannelJobItem,
  code: ChannelJobBlockCode,
  reason: string,
  deviceId: string | null = null,
) => {
  if (job.blockedCode === code && job.blockedReason === reason && job.deviceId === deviceId) return;

  await tx
    .update(channelJobs)
    .set({ blockedCode: code, blockedReason: reason, deviceId })
    .where(eq(channelJobs.id, job.id));
  await audit(tx, job.channelId, 'job_blocked', job.id, { code, deviceId, reason });
};

const ACCESS_PENDING_REASON = 'Waiting for the Agent owner to allow access';

/**
 * Whether a queued job is not waiting for an Agent owner's answer to its requester. Such a job
 * waits on one person's permission, not on the member's queue, so it never holds the replies of
 * the people who may use the Agent; it is claimed again on its own (see `candidates`).
 */
export const notAwaitingAccess = () =>
  sql`${channelJobs.blockedCode} IS DISTINCT FROM 'access_request_pending'`;

/**
 * Settles a job whose requester the Agent's owner declined: failed, with the declined access as
 * its code, and the manifest its card in the reply slot is written from. It never ran, so it has
 * no operation; asking again (`requestAgentAccess`) queues it once more.
 */
const settleAccessDenied = async (
  tx: Transaction,
  job: ChannelJobItem,
  member: ChannelMemberItem,
  request: ChannelMessageItem,
  thread: ChannelThreadItem | null,
) => {
  await tx
    .update(channelJobs)
    .set({
      blockedCode: 'access_denied',
      blockedReason: 'The Agent owner declined access',
      deviceId: null,
      manifest: buildManifest({ job, member, request, thread }),
      status: 'failed',
    })
    .where(eq(channelJobs.id, job.id));
  await audit(tx, job.channelId, 'job_access_denied', job.id);
};

/** Settles a job that must never run, e.g. its requester left or its branch was archived. */
const cancel = async (tx: Transaction, job: ChannelJobItem, reason: string) => {
  await tx
    .update(channelJobs)
    .set({ blockedCode: null, blockedReason: null, status: 'cancelled' })
    .where(eq(channelJobs.id, job.id));
  await audit(tx, job.channelId, 'job_cancelled', job.id, { reason });
};

type Block = { code: ChannelJobBlockCode; reason: string };

const APPROVAL_PENDING: Block = {
  code: 'device_approval_pending',
  reason: 'Waiting for the device owner to approve',
};

/**
 * Whether the member may run on its device. Fails closed: outside a personal channel, a
 * device that is not public in this workspace needs an approved grant for exactly the
 * member's current device and directory. A missing grant (never
 * requested, or deleted with the owner's account) blocks like a pending one.
 */
const deviceBlock = async (
  tx: Transaction,
  channel: ChannelItem,
  member: ChannelMemberItem,
  job: Pick<ChannelJobItem, 'requesterMemberId'>,
): Promise<Block | undefined> => {
  const { deviceId, deviceOwnerId, workingDirectory } = member.config ?? {};
  if (workingDirectory && !deviceId)
    return { code: 'unavailable', reason: 'A working directory requires a device' };
  if (!deviceId) return;

  if (!channel.workspaceId)
    return deviceOwnerId && deviceOwnerId === channel.userId
      ? undefined
      : { code: 'unavailable', reason: 'The device does not belong to this channel owner' };

  const [shared] = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(
      and(
        eq(devices.deviceId, deviceId),
        eq(devices.workspaceId, channel.workspaceId),
        eq(devices.visibility, 'public'),
      ),
    )
    .limit(1);
  if (shared) return;

  if (!deviceOwnerId || !workingDirectory) return APPROVAL_PENDING;
  const [grant] = await tx
    .select()
    .from(channelMemberGrants)
    .where(eq(channelMemberGrants.memberId, member.id));
  // Picked while the device was public, then made private: ask its owner now.
  if (!grant) {
    await requestMissingGrant(tx, channel, member, job.requesterMemberId);
    return APPROVAL_PENDING;
  }
  if (
    !grant ||
    grant.deviceId !== deviceId ||
    grant.deviceOwnerId !== deviceOwnerId ||
    grant.workingDirectory !== workingDirectory
  )
    return APPROVAL_PENDING;
  if (grant.status === 'pending') return APPROVAL_PENDING;
  if (grant.status !== 'approved')
    return { code: 'unavailable', reason: 'The device owner did not allow this environment' };
};

/**
 * Another live writer in the same device directory, from any channel or member. Holds the
 * directory's advisory lock until the claim commits, so two claims never both take it.
 */
const directoryBlock = async (
  tx: Transaction,
  deviceId: string | undefined,
  workingDirectory: string | undefined,
): Promise<Block | undefined> => {
  if (!deviceId || !workingDirectory) return;

  // Claims in other channels race for the same directory, and no channel lock covers them:
  // this lock orders them, so the read below sees a writer the other claim just committed.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`channel-directory:${JSON.stringify([deviceId, workingDirectory])}`}))`,
  );
  const [busy] = await tx
    .select({ id: channelJobs.id })
    .from(channelJobs)
    .where(
      and(
        eq(channelJobs.deviceId, deviceId),
        eq(channelJobs.workingDirectory, workingDirectory),
        eq(channelJobs.writerHeld, true),
      ),
    )
    .limit(1);
  if (busy) return { code: 'directory_locked', reason: 'Another run is using this directory' };
};

/**
 * Blocks that wait on a device or a person, not on work that will finish by itself. A primary
 * responder stuck on one of these no longer holds back the follow-ups deferred behind it: they
 * run without its reply rather than wait indefinitely.
 */
const STUCK_BLOCKS = new Set<ChannelJobBlockCode>([
  'device_approval_pending',
  'device_offline',
  'device_required',
  'unavailable',
  'workspace_changed',
]);

/**
 * The run that answers a request: the job whose manifest lists the message in its batch. A request
 * settled as `merged` has no writer and no queued row of its own — the run that merged it holds it.
 */
const answeringRun = async (
  tx: Transaction,
  channelId: string,
  memberId: string,
  messageId: string,
) => {
  const [owner] = await tx
    .select({
      blockedCode: channelJobs.blockedCode,
      isolatedAt: channelJobs.isolatedAt,
      publishedMessageId: channelJobs.publishedMessageId,
      status: channelJobs.status,
      writerHeld: channelJobs.writerHeld,
    })
    .from(channelJobs)
    .where(
      and(
        eq(channelJobs.channelId, channelId),
        eq(channelJobs.memberId, memberId),
        inArray(channelJobs.status, ['queued', 'running', 'completed']),
        sql`${channelJobs.manifest} -> 'requestMessageIds' @> ${JSON.stringify([messageId])}::jsonb`,
      ),
    )
    .orderBy(desc(channelJobs.claimedAt))
    .limit(1);

  return owner;
};

/** The job of the member a deferred follow-up waits for, on the same message. */
const primaryJob = async (tx: Transaction, job: ChannelJobItem, memberId: string) => {
  const [primary] = await tx
    .select({
      blockedCode: channelJobs.blockedCode,
      publishedMessageId: channelJobs.publishedMessageId,
      status: channelJobs.status,
    })
    .from(channelJobs)
    .where(
      and(
        eq(channelJobs.channelId, job.channelId),
        eq(channelJobs.messageId, job.messageId),
        eq(channelJobs.memberId, memberId),
      ),
    );
  // The request was queued right behind an earlier one of the same person and answered by that
  // earlier request's run, which settles it as `merged`. Its answer is the batch's answer, so the
  // follow-up waits for, and reads the reply of, the run that merged it.
  if (primary?.status !== 'merged') return primary;

  const owner = await answeringRun(tx, job.channelId, memberId, job.messageId);

  return owner ?? primary;
};

/**
 * Whether the primary responder may still answer: running, or queued behind work that will
 * finish. Completed, silent, failed and cancelled jobs have settled; a missing job (the primary
 * was not delivered) never holds anyone back.
 */
const awaitsPrimary = (primary: { blockedCode: ChannelJobBlockCode | null; status: string }) =>
  primary.status === 'running' ||
  (primary.status === 'queued' && !(primary.blockedCode && STUCK_BLOCKS.has(primary.blockedCode)));

/**
 * Starts the job if it is at the head of its member's queue and nothing holds the member,
 * its environment or its directory. The caller holds the channel lock. Returns null when
 * the job cannot start now; a lasting reason is recorded on the job as `blockedCode`.
 */
export const claimJob = async (
  tx: Transaction,
  channel: ChannelItem,
  jobId: string,
  options: ChannelClaimOptions,
): Promise<ChannelClaim | null> => {
  if (channel.isDeleted) return null;

  const [job] = await tx
    .select()
    .from(channelJobs)
    .where(
      and(
        eq(channelJobs.channelId, channel.id),
        eq(channelJobs.id, jobId),
        eq(channelJobs.status, 'queued'),
      ),
    );
  if (!job) return null;

  // Archiving stops the work it covers; a job queued against it must never start.
  if (channel.status === 'archived') {
    await cancel(tx, job, 'channel_archived');
    return null;
  }
  const thread = await findThread(tx, channel.id, job.threadId);
  if (thread?.status === 'archived') {
    await cancel(tx, job, 'thread_archived');
    return null;
  }

  // A deferred follow-up waits for the message's primary responder, then sees its reply.
  const primary = job.wake?.afterMemberId
    ? await primaryJob(tx, job, job.wake.afterMemberId)
    : undefined;
  if (primary && awaitsPrimary(primary)) {
    await block(tx, job, 'awaiting_primary', AWAITING_PRIMARY_REASON);
    return null;
  }

  const [request] = await tx
    .select()
    .from(channelMessages)
    .where(eq(channelMessages.id, job.messageId));
  // A request deleted while this job waited must not run: its tombstone carries no text or
  // mentions, so the run would answer a message that no longer exists.
  if (channelMessageDeletedAt(request.metadata)) {
    await cancel(tx, job, 'request_deleted');
    return null;
  }

  // The requester is the execution identity; without them there is nobody to run as.
  const [requester] = await tx
    .select({ id: channelMembers.id, userId: channelMembers.userId })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.id, job.requesterMemberId),
        eq(channelMembers.actorType, 'user'),
        eq(channelMembers.status, 'active'),
        isNotNull(channelMembers.userId),
      ),
    );
  if (!requester?.userId) {
    await cancel(tx, job, 'requester_unavailable');
    return null;
  }
  // Whether the requester may use the Agent at all comes before any ordering: a request waiting
  // for its owner's answer holds back no one else's reply (see `awaitingAccess`).
  const [agentMember] = await tx
    .select()
    .from(channelMembers)
    .where(and(eq(channelMembers.id, job.memberId), eq(channelMembers.status, 'active')));
  if (!agentMember) return null;
  const access = await resolveChannelAgentAccess(
    tx,
    channel,
    agentMember,
    { memberId: requester.id, userId: requester.userId },
    job.threadId,
  );
  if (access.kind === 'request') {
    if (access.grant?.status === 'rejected') {
      await settleAccessDenied(tx, job, agentMember, request, thread ?? null);
      options.onAccessDenied?.(job.id);
      return null;
    }
    // Asked once: a request already waiting keeps its card; the owner's answer wakes the Channel.
    if (access.grant?.status !== 'pending')
      await fileAgentAccessRequest(tx, channel.id, {
        memberId: agentMember.id,
        missing: access.missing,
        ownerId: access.ownerId,
        requesterMemberId: requester.id,
      });
    await block(tx, job, 'access_request_pending', ACCESS_PENDING_REASON);
    return null;
  }
  // An earlier undecided message in this branch may still enqueue this member ahead of it, and
  // so may the Thread's root while it is undecided. Checking only jobs would let a later
  // request overtake it while another worker routes it. Other branches never hold this one.
  const [pendingRoute] = await tx
    .select({ id: channelMessages.id })
    .from(channelMessages)
    .where(
      and(
        eq(channelMessages.channelId, channel.id),
        eq(channelMessages.routingStatus, 'pending'),
        lt(channelMessages.sequence, request.sequence),
        job.threadId
          ? or(
              eq(channelMessages.threadId, job.threadId),
              thread ? eq(channelMessages.id, thread.rootMessageId) : undefined,
            )
          : isNull(channelMessages.threadId),
      ),
    )
    .limit(1);
  if (pendingRoute) {
    await block(tx, job, 'member_busy', 'Waiting for an earlier routing decision');
    return null;
  }

  // Each member answers a branch in message order; its other branches run alongside.
  const [head] = await tx
    .select({ id: channelJobs.id })
    .from(channelJobs)
    .innerJoin(channelMessages, eq(channelMessages.id, channelJobs.messageId))
    .where(
      and(
        eq(channelJobs.memberId, job.memberId),
        eq(channelJobs.status, 'queued'),
        sameBranch(job.threadId),
        or(notAwaitingAccess(), eq(channelJobs.id, job.id)),
      ),
    )
    .orderBy(asc(channelMessages.sequence), asc(channelJobs.createdAt))
    .limit(1);
  if (head?.id !== job.id) {
    await block(tx, job, 'member_busy', 'Waiting for an earlier reply from this Agent');
    return null;
  }

  // A Thread follows its root: the member answers the root on the main timeline first.
  const [root] = thread
    ? await tx
        .select({
          isolatedAt: channelJobs.isolatedAt,
          status: channelJobs.status,
          writerHeld: channelJobs.writerHeld,
        })
        .from(channelJobs)
        .where(
          and(
            eq(channelJobs.memberId, job.memberId),
            eq(channelJobs.messageId, thread.rootMessageId),
            isNull(channelJobs.threadId),
          ),
        )
        .limit(1)
    : [];
  // The root may have been settled as `merged` into an earlier run of the same batch: such a row
  // has no writer and no queued row of its own, yet that run still owes the root its answer. So
  // resolve it to the run that answers it before deciding, the way `primaryJob()` does.
  const rootReply =
    root?.status === 'merged'
      ? await answeringRun(tx, channel.id, job.memberId, thread!.rootMessageId)
      : root;
  if (
    rootReply &&
    (rootReply.status === 'queued' || (rootReply.writerHeld && rootReply.isolatedAt === null))
  ) {
    await block(tx, job, 'member_busy', 'Waiting for an earlier reply from this Agent');
    return null;
  }

  const [member] = await tx
    .select()
    .from(channelMembers)
    .where(and(eq(channelMembers.id, job.memberId), eq(channelMembers.status, 'active')));
  if (!member?.config) return null;

  const [busy] = await tx
    .select({ id: channelJobs.id })
    .from(channelJobs)
    .where(
      and(
        eq(channelJobs.memberId, member.id),
        eq(channelJobs.writerHeld, true),
        isNull(channelJobs.isolatedAt),
        sameBranch(job.threadId),
      ),
    )
    .limit(1);
  if (busy) {
    await block(tx, job, 'member_busy', 'Waiting for an earlier reply from this Agent');
    return null;
  }

  const resolved = await resolveExecutionConfig(
    tx,
    channel,
    member,
    requester.userId,
    options.serverDefaultAgentConfig,
    access,
  );
  // A branch that moved into its own worktree runs there; the grant still covers the
  // configured directory it was cut from.
  const worktree = assignedWorktree(member, job.threadId);
  const executionConfig =
    resolved && worktree
      ? { ...resolved, workingDirectory: worktree.path, worktreeBranch: worktree.branch }
      : resolved;
  if (!executionConfig) {
    await block(tx, job, 'unavailable', 'The Agent is unavailable');
    return null;
  }

  const blocked =
    (await deviceBlock(tx, channel, member, job)) ??
    (sharesDirectory(member)
      ? undefined
      : await directoryBlock(tx, member.config.deviceId, executionConfig.workingDirectory));
  if (blocked) {
    await block(tx, job, blocked.code, blocked.reason);
    return null;
  }

  // The execution identity the topic belongs to: a shared Agent's owner (with the requester as
  // `senderId`), else the requester. The routing pre-check below and the claim itself resolve
  // the same topic, so they have to agree on this scope.
  const { share } = executionConfig;
  const scope: ChannelTopicScope = share
    ? { senderId: requester.userId!, userId: share.ownerId, workspaceId: share.workspaceId }
    : { userId: requester.userId!, workspaceId: channel.workspaceId };

  // A resumed reply continues the topic its failed run worked in, when it still can.
  const resumed = await resumableTopic(tx, job, member, scope, executionConfig);

  // A device picked in the Channel, else the one the Agent's own settings route the run to.
  const channelDeviceId = member.config?.deviceId;
  const routed =
    options.onlineDeviceIds && !channelDeviceId
      ? await options.routedDevice?.({
          agentId: member.agentId!,
          continuation:
            resumed ??
            (await continuationTopic(
              tx,
              channel,
              job,
              member,
              scope,
              request.sequence,
              executionConfig,
            )),
          executionConfig,
          userId: scope.userId,
          workspaceId: scope.workspaceId,
        })
      : undefined;
  const offlineDeviceId = !options.onlineDeviceIds
    ? undefined
    : channelDeviceId
      ? options.onlineDeviceIds.includes(channelDeviceId)
        ? undefined
        : channelDeviceId
      : routed && !routed.online
        ? routed.deviceId
        : undefined;
  if (offlineDeviceId) {
    await block(
      tx,
      job,
      'device_offline',
      'Waiting for the configured device to connect',
      offlineDeviceId,
    );
    return null;
  }

  const now = new Date();
  const topic =
    resumed ??
    (await resolveTopic(tx, channel, job, member, scope, request.sequence, executionConfig));
  // The requester's next requests queued behind this one are answered in the same run. A shared
  // Agent's visitor is metered per request, so each of theirs stays its own run.
  const merged = share ? [] : await findMergeableRequests(tx, job, request);
  const manifest = buildManifest({
    job,
    member,
    merged: merged.map((next) => next.request),
    primaryReplyMessageId: primary?.publishedMessageId ?? undefined,
    request,
    resumed: !!resumed,
    thread,
  });
  // Same shape as ordinary runs (`op_{ts}_{agentId}_{topicId}_{rand}`): trace storage
  // derives the Agent and topic from the operation ID.
  const operationId = `op_${Date.now()}_${member.agentId}_${topic.id}_${createNanoId(8)()}`;
  await tx.insert(agentOperations).values({
    id: operationId,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    topicId: topic.id,
    agentId: member.agentId,
    trigger: 'channel',
    status: 'idle',
    model: executionConfig.model,
    provider: executionConfig.provider,
  });
  const [updated] = await tx
    .update(channelJobs)
    .set({
      claimedAt: sql`clock_timestamp()`,
      blockedCode: null,
      blockedReason: null,
      // Only a device picked in the Channel; a wait marker from `block` must not linger.
      deviceId: member.config!.deviceId ?? null,
      executionConfig,
      leaseExpiresAt: new Date(now.getTime() + options.leaseMs),
      leaseOwner: options.leaseOwner,
      manifest,
      operationId,
      topicId: topic.id,
      status: 'running',
      workingDirectory: executionConfig.workingDirectory,
      writerHeld: true,
    })
    .where(eq(channelJobs.id, job.id))
    .returning();
  await mergeJobs(
    tx,
    updated,
    merged.map((next) => next.job.id),
  );
  const claimed = { job: updated, topic };

  await audit(tx, channel.id, 'run_claimed', job.id, {
    cutoff: claimed.job.manifest!.cutoffSequence,
    operationId: claimed.job.operationId,
  });

  return { ...claimed, member };
};
