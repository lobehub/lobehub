import type { ChannelJobBlockCode, LobeAgentConfig } from '@lobechat/types';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PartialDeep } from 'type-fest';

import type { ChannelItem, ChannelJobItem, ChannelMemberItem, TopicItem } from '../../schemas';
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
import { findThread } from './delivery';
import { buildManifest } from './manifest';
import { resolveTopic } from './topic';
import { audit } from './transaction';

export interface ChannelClaimOptions {
  /** How long the claimer may go without a heartbeat before reconcile takes over. */
  leaseMs: number;
  /** Process or queue worker that will drive the run. */
  leaseOwner: string;
  /** Trusted presence snapshot from the current Gateway scope; omitted by storage-only callers. */
  onlineDeviceIds?: string[];
  /** Trusted server defaults from getServerDefaultAgentConfig(); use {} when unconfigured. */
  serverDefaultAgentConfig: PartialDeep<LobeAgentConfig>;
}

export interface ChannelClaim {
  /** The claimed job, with its reserved `operationId` and frozen `manifest`. */
  job: ChannelJobItem;
  member: ChannelMemberItem;
  /** Ordinary Agent topic, reused when safe; also the operation's `topicId`. */
  topic: TopicItem;
}

const DIRECTORY_LOCK = 'channel_jobs_active_directory_unique';

const uniqueViolation = (error: unknown): string | undefined => {
  const pgError = error as {
    cause?: { code?: string; constraint?: string };
    code?: string;
    constraint?: string;
  };
  const code = pgError.cause?.code ?? pgError.code;
  return code === '23505' ? (pgError.cause?.constraint ?? pgError.constraint ?? '') : undefined;
};

/** Records why a queued job cannot start; clients read the code, never the text. */
const block = async (
  tx: Transaction,
  job: ChannelJobItem,
  code: ChannelJobBlockCode,
  reason: string,
) => {
  if (job.blockedCode === code && job.blockedReason === reason) return;

  await tx
    .update(channelJobs)
    .set({ blockedCode: code, blockedReason: reason })
    .where(eq(channelJobs.id, job.id));
  await audit(tx, job.channelId, 'job_blocked', job.id, { code, reason });
};

/** Settles a job that must never run, e.g. its requester left or its environment changed. */
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

/** Another channel's live writer in the same device directory. */
const directoryBlock = async (
  tx: Transaction,
  member: ChannelMemberItem,
): Promise<Block | undefined> => {
  const { deviceId, workingDirectory } = member.config ?? {};
  if (!deviceId || !workingDirectory) return;

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

  // Each member answers in message order.
  const [head] = await tx
    .select({ id: channelJobs.id })
    .from(channelJobs)
    .innerJoin(channelMessages, eq(channelMessages.id, channelJobs.messageId))
    .where(and(eq(channelJobs.memberId, job.memberId), eq(channelJobs.status, 'queued')))
    .orderBy(asc(channelMessages.sequence), asc(channelJobs.createdAt))
    .limit(1);
  if (head?.id !== job.id) return null;

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
      ),
    )
    .limit(1);
  if (busy) return null;

  const [request] = await tx
    .select()
    .from(channelMessages)
    .where(eq(channelMessages.id, job.messageId));
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

  const executionConfig = await resolveExecutionConfig(
    tx,
    channel,
    member,
    requester.userId,
    options.serverDefaultAgentConfig,
  );
  if (!executionConfig) {
    await block(tx, job, 'unavailable', 'The Agent is unavailable');
    return null;
  }

  const blocked = (await deviceBlock(tx, channel, member)) ?? (await directoryBlock(tx, member));
  if (blocked) {
    await block(tx, job, blocked.code, blocked.reason);
    return null;
  }

  if (
    member.config?.deviceId &&
    options.onlineDeviceIds &&
    !options.onlineDeviceIds.includes(member.config.deviceId)
  ) {
    await block(tx, job, 'device_offline', 'Waiting for the configured device to connect');
    return null;
  }

  const thread = await findThread(tx, channel.id, job.threadId);

  const now = new Date();
  let claimed: Omit<ChannelClaim, 'member'>;
  try {
    // A savepoint, so losing the directory race to another channel keeps this transaction
    // and leaves no topic or operation behind.
    claimed = await tx.transaction(async (savepoint) => {
      const { topic, afterSequence } = await resolveTopic(
        savepoint,
        channel,
        job,
        member,
        requester.userId!,
        request.sequence,
        executionConfig,
      );
      const manifest = buildManifest({ afterSequence, job, member, request, thread });
      const operationId = `op_${createNanoId(16)()}`;
      await savepoint.insert(agentOperations).values({
        id: operationId,
        userId: requester.userId!,
        workspaceId: channel.workspaceId,
        topicId: topic.id,
        agentId: member.agentId,
        trigger: 'channel',
        status: 'idle',
        model: executionConfig.model,
        provider: executionConfig.provider,
      });
      const [updated] = await savepoint
        .update(channelJobs)
        .set({
          claimedAt: sql`clock_timestamp()`,
          blockedCode: null,
          blockedReason: null,
          deviceId: member.config!.deviceId,
          executionConfig,
          leaseExpiresAt: new Date(now.getTime() + options.leaseMs),
          leaseOwner: options.leaseOwner,
          manifest,
          operationId,
          topicId: topic.id,
          status: 'running',
          workingDirectory: member.config!.workingDirectory,
          writerHeld: true,
        })
        .where(eq(channelJobs.id, job.id))
        .returning();
      return { job: updated, topic };
    });
  } catch (error) {
    const constraint = uniqueViolation(error);
    if (constraint === undefined) throw error;
    if (constraint === DIRECTORY_LOCK)
      await block(tx, job, 'directory_locked', 'Another run is using this directory');
    return null;
  }

  await audit(tx, channel.id, 'run_claimed', job.id, {
    cutoff: claimed.job.manifest!.cutoffSequence,
    operationId: claimed.job.operationId,
  });

  return { ...claimed, member };
};
