import type { ChannelInputManifest, ChannelJobWake, LobeAgentConfig } from '@lobechat/types';
import { channelMessageReceipt, channelMessageVia } from '@lobechat/types';
import { and, asc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { PartialDeep } from 'type-fest';

import type {
  ChannelItem,
  ChannelJobItem,
  ChannelMemberItem,
  ChannelMessageItem,
} from '../../schemas';
import { channelJobs, channelMembers, channelMessages } from '../../schemas';
import type { Transaction } from '../../type';
import { resolveExecutionConfig } from './agent';
import { fileIdsByMessage } from './attachments';
import { audit } from './transaction';

/** Jobs in the same conversation branch: one Thread, or the main timeline. */
export const sameBranch = (threadId: string | null) =>
  threadId ? eq(channelJobs.threadId, threadId) : isNull(channelJobs.threadId);

const requestColumns = {
  agentId: channelMessages.agentId,
  metadata: channelMessages.metadata,
};

/** Asked by a person here: not by an Agent, not relayed or brought back from another Channel. */
const isPersonRequest = (request: Pick<ChannelMessageItem, 'agentId' | 'metadata'>) =>
  !request.agentId &&
  !channelMessageVia(request.metadata) &&
  !channelMessageReceipt(request.metadata);

/** Every request a manifest answers, oldest first. */
export const manifestRequestIds = (manifest: ChannelInputManifest) =>
  manifest.requestMessageIds ?? [manifest.requestMessageId];

export interface MergeQueuedOptions {
  /**
   * A running Native run reads what it takes in as one plain-text message, so a request with
   * attachments, or one quoting another message, waits for its own run instead.
   */
  plainTextOnly?: boolean;
  /** Trusted server defaults, to recheck a different requester's access to the Agent. */
  serverDefaultAgentConfig: PartialDeep<LobeAgentConfig>;
}

export interface MergedRequests {
  /** The target's manifest, now covering the merged requests. */
  manifest: ChannelInputManifest;
  /** Request message ids taken in, oldest first. */
  messageIds: string[];
  /** The target's cutoff before the merge: what it had already read. */
  previousCutoff: number;
}

/**
 * Takes the member's queued requests in this branch into `target`, which answers them in one
 * reply: the queue head at its claim, or a running Native run before its next step. The caller
 * holds the channel lock and `target` already has its manifest.
 *
 * Only the leading run of the queue moves, so the member still answers in message order: the
 * first job that cannot merge stops it. A job cannot merge while an earlier routing decision is
 * pending in the branch, while it is deferred behind another member's answer, or when its
 * requester could not run the Agent themselves. People other than the target's requester are
 * read as input; the run keeps the target's execution identity, as recent context already does.
 * A shared Agent's run is billed to one visitor, so it takes in only that visitor's requests.
 */
export const mergeQueuedRequests = async (
  tx: Transaction,
  channel: ChannelItem,
  member: ChannelMemberItem,
  target: ChannelJobItem,
  options: MergeQueuedOptions,
): Promise<MergedRequests | undefined> => {
  const manifest = target.manifest;
  if (!manifest) return;

  // An answer between Agents, or across Channels, goes back for its one request; those stay
  // runs of their own, and never take others in.
  const [head] = await tx
    .select(requestColumns)
    .from(channelMessages)
    .where(eq(channelMessages.id, manifest.requestMessageId));
  if (!head || !isPersonRequest(head)) return;

  const queued = await tx
    .select({ job: channelJobs, request: requestColumns, sequence: channelMessages.sequence })
    .from(channelJobs)
    .innerJoin(channelMessages, eq(channelMessages.id, channelJobs.messageId))
    .where(
      and(
        eq(channelJobs.channelId, channel.id),
        eq(channelJobs.memberId, target.memberId),
        eq(channelJobs.status, 'queued'),
        sameBranch(target.threadId),
        gt(channelMessages.sequence, manifest.cutoffSequence),
      ),
    )
    .orderBy(asc(channelMessages.sequence), asc(channelJobs.createdAt));
  if (!queued.length) return;

  // An undecided message may still give this member a job that sorts before the later ones.
  const [pendingRoute] = await tx
    .select({ sequence: channelMessages.sequence })
    .from(channelMessages)
    .where(
      and(
        eq(channelMessages.channelId, channel.id),
        eq(channelMessages.routingStatus, 'pending'),
        gt(channelMessages.sequence, manifest.cutoffSequence),
        target.threadId
          ? eq(channelMessages.threadId, target.threadId)
          : isNull(channelMessages.threadId),
      ),
    )
    .orderBy(asc(channelMessages.sequence))
    .limit(1);

  const requesters = await tx
    .select({ id: channelMembers.id, userId: channelMembers.userId })
    .from(channelMembers)
    .where(
      and(
        inArray(channelMembers.id, [...new Set(queued.map(({ job }) => job.requesterMemberId))]),
        eq(channelMembers.actorType, 'user'),
        eq(channelMembers.status, 'active'),
        isNotNull(channelMembers.userId),
      ),
    );
  const requesterUser = new Map(requesters.map(({ id, userId }) => [id, userId!]));
  const plain = options.plainTextOnly
    ? await plainTextRequests(
        tx,
        queued.map(({ job }) => job.messageId),
      )
    : undefined;
  const allowed = new Map<string, boolean>();
  const mayRequest = async (requesterMemberId: string) => {
    if (requesterMemberId === target.requesterMemberId) return true;
    if (target.executionConfig?.share) return false;
    const userId = requesterUser.get(requesterMemberId);
    if (!userId) return false;
    if (!allowed.has(userId))
      allowed.set(
        userId,
        !!(await resolveExecutionConfig(
          tx,
          channel,
          member,
          userId,
          options.serverDefaultAgentConfig,
        )),
      );
    return allowed.get(userId)!;
  };

  const taken: typeof queued = [];
  for (const entry of queued) {
    const { job, sequence } = entry;
    if (pendingRoute && sequence > pendingRoute.sequence) break;
    // Deferred behind another member's answer to its own message: it must read that first.
    if (job.wake?.afterMemberId) break;
    if (!isPersonRequest(entry.request)) break;
    if (plain && !plain.has(job.messageId)) break;
    if (!(await mayRequest(job.requesterMemberId))) break;
    taken.push(entry);
  }
  if (!taken.length) return;

  const messageIds = taken.map(({ job }) => job.messageId);
  const merged: ChannelInputManifest = {
    ...manifest,
    cutoffSequence: taken.at(-1)!.sequence,
    requestMessageIds: [...manifestRequestIds(manifest), ...messageIds],
  };
  // An owed answer in the batch makes the whole reply owed: it may no longer end in silence.
  const owes = taken.some(({ job }) => !job.wake);
  const wake: ChannelJobWake | null = owes ? null : target.wake;

  await tx.update(channelJobs).set({ manifest: merged, wake }).where(eq(channelJobs.id, target.id));
  const ids = taken.map(({ job }) => job.id);
  await tx
    .update(channelJobs)
    .set({
      blockedCode: null,
      blockedReason: null,
      status: 'merged',
    })
    .where(and(inArray(channelJobs.id, ids), eq(channelJobs.status, 'queued')));
  for (const id of ids) await audit(tx, channel.id, 'job_merged', id, { into: target.id });

  return { manifest: merged, messageIds, previousCutoff: manifest.cutoffSequence };
};

/** Of these request messages, the ones a running turn can read as text: no files, no quote. */
const plainTextRequests = async (tx: Transaction, messageIds: string[]) => {
  const [files, quoting] = await Promise.all([
    fileIdsByMessage(tx, messageIds),
    tx
      .select({ id: channelMessages.id })
      .from(channelMessages)
      .where(and(inArray(channelMessages.id, messageIds), isNotNull(channelMessages.replyToId))),
  ]);
  const excluded = new Set([...files.keys(), ...quoting.map(({ id }) => id)]);
  return new Set(messageIds.filter((id) => !excluded.has(id)));
};

/**
 * The run that took requests in failed: they go back to the member's queue, where the next
 * claim takes them up again, so a failure never swallows a request it was only carrying. A
 * stopped run keeps them: stopping a reply stops what it answers.
 */
export const requeueMerged = async (tx: Transaction, target: ChannelJobItem) => {
  const merged = target.manifest
    ? manifestRequestIds(target.manifest).filter((id) => id !== target.messageId)
    : [];
  if (!merged.length) return;
  const requeued = await tx
    .update(channelJobs)
    .set({ status: 'queued' })
    .where(
      and(
        eq(channelJobs.channelId, target.channelId),
        eq(channelJobs.memberId, target.memberId),
        eq(channelJobs.status, 'merged'),
        inArray(channelJobs.messageId, merged),
      ),
    )
    .returning({ id: channelJobs.id });
  for (const { id } of requeued)
    await audit(tx, target.channelId, 'job_requeued', id, { from: target.id });
};
