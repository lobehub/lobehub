import type { ChannelDetail, ChannelPublicJob, ChannelReplyJob } from '@lobechat/types';
import type { AgentAvatarState } from '@lobehub/ui';

export const channelJobStatus = (job: ChannelReplyJob) =>
  job.publicationRevoked && job.writerHeld
    ? 'status.stopping'
    : job.status === 'queued'
      ? job.blockedCode
        ? (`blocked.${job.blockedCode}` as const)
        : 'status.preparing'
      : (`status.${job.status}` as const);

/** On a member's own row, a running reply is described by what the Agent is doing. */
export const memberJobStatus = (job: ChannelReplyJob) => {
  const status = channelJobStatus(job);
  return status === 'status.running' ? ('status.working' as const) : status;
};

/**
 * A follow-up deferred behind the message's primary responder. It starts only once that reply
 * settles and may well stay silent, so until then it is not a reply in progress.
 */
export const isAwaitingPrimary = (job: ChannelReplyJob) =>
  job.status === 'queued' && job.blockedCode === 'awaiting_primary';

/** Colour family of a status: working blue, attention amber, error red, settled grey. */
export type ChannelStatusTone = 'attention' | 'done' | 'error' | 'quiet' | 'working';

export const channelJobTone = (job: ChannelReplyJob): ChannelStatusTone => {
  if (job.status === 'failed') return 'error';
  if (job.publicationRevoked) return job.writerHeld ? 'attention' : 'quiet';
  if (job.status === 'queued')
    return isAwaitingPrimary(job) ? 'quiet' : job.blockedCode ? 'attention' : 'working';
  if (job.status === 'running') return 'working';
  if (job.status === 'completed') return 'done';
  return 'quiet';
};

/** Still able to publish a reply, so the user can stop it. */
export const isChannelJobActive = (job: ChannelReplyJob) =>
  !job.publicationRevoked && (job.status === 'queued' || job.status === 'running');

/** Work the conversation is still waiting on: shown above the composer, not on messages. */
export const replyActivityJobs = <T extends ChannelReplyJob>(jobs: T[]) =>
  jobs.filter(
    (job) =>
      (isChannelJobActive(job) && !isAwaitingPrimary(job)) ||
      (job.publicationRevoked && job.writerHeld),
  );

/**
 * Each member's newest job when it failed. A later reply, stop or retry by the same member
 * settles the failure, so the header does not stay red forever. Jobs arrive newest first. A
 * request merged into an earlier run settles with that run, so it settles nothing itself.
 */
export const unresolvedFailures = <T extends ChannelReplyJob>(jobs: T[]) => {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    if (job.status === 'merged' || seen.has(job.memberId)) return false;
    seen.add(job.memberId);
    return job.status === 'failed';
  });
};

/**
 * The header's failures: the main conversation's own. Its view also carries replies still at
 * work in threads, and one of those must not hide, then bring back, a main-timeline failure.
 */
export const mainTimelineFailures = <T extends ChannelReplyJob>(jobs: T[]) =>
  unresolvedFailures(jobs.filter((job) => !job.threadId));

type FailedReply = Pick<ChannelPublicJob, 'messageId' | 'openingMessageId' | 'status' | 'threadId'>;

const append = <T>(map: Map<string, T[]>, key: string, value: T) =>
  map.set(key, [...(map.get(key) ?? []), value]);

/**
 * Where a conversation's failed replies show, keyed by message id, oldest first: under the
 * acknowledgement the reply posted before its run (`underMessage`), or, when it posted none or
 * that is not loaded, as the Agent's own row after the request (`afterMessage`). A reply whose
 * request is not loaded either shows only in the header.
 */
export const replyFailurePlacement = <T extends FailedReply>(
  jobs: T[],
  loadedMessageIds: ReadonlySet<string>,
  threadId: string | null,
) => {
  const underMessage = new Map<string, T[]>();
  const afterMessage = new Map<string, T[]>();
  // Jobs arrive newest first; a message lists its failures in the order they happened.
  for (const job of [...jobs].reverse()) {
    if (job.status !== 'failed' || (job.threadId ?? null) !== threadId) continue;
    if (job.openingMessageId && loadedMessageIds.has(job.openingMessageId))
      append(underMessage, job.openingMessageId, job);
    else if (loadedMessageIds.has(job.messageId)) append(afterMessage, job.messageId, job);
  }
  return { afterMessage, underMessage };
};

/** What a member is busy with now: a running reply first, then the next queued one. */
export const memberCurrentJob = <T extends ChannelReplyJob>(jobs: T[], memberId: string) => {
  const own = jobs.filter((job) => job.memberId === memberId);
  return (
    own.find((job) => isChannelJobActive(job) && job.status === 'running') ??
    own.find(isChannelJobActive) ??
    own.find((job) => job.publicationRevoked && job.writerHeld) ??
    unresolvedFailures(own)[0]
  );
};

/** Replies a conversation still waits on, and whether a sent message awaits routing. */
export const conversationReplies = (detail: ChannelDetail, threadId: string | null) => {
  const { jobs = [], messages = [] } = detail;
  return {
    jobs: replyActivityJobs(jobs.filter((job) => (job.threadId ?? null) === threadId)),
    receiving: messages.some((message) => message.routingStatus === 'pending'),
  };
};

/** Whether the conversation has a reply or routing in progress to show above the composer. */
export const hasReplyActivity = (detail: ChannelDetail, threadId: string | null) => {
  const { jobs, receiving } = conversationReplies(detail, threadId);
  return jobs.length > 0 || receiving;
};

/**
 * How a direct conversation's Agent avatar acts out its pending replies: `working` while it
 * writes, `thinking` while a message is routed or the reply is prepared, `waiting` when blocked
 * or stopping. Undefined when nothing is pending, so the avatar stays idle.
 */
export const replyAvatarState = (
  jobs: ChannelReplyJob[],
  receiving = false,
): AgentAvatarState | undefined => {
  const pending = replyActivityJobs(jobs);
  const job = pending[0] && memberCurrentJob(pending, pending[0].memberId);
  if (!job) return receiving ? 'thinking' : undefined;
  if (channelJobTone(job) !== 'working') return 'waiting';
  return job.status === 'running' ? 'working' : 'thinking';
};

/** The avatar state of a loaded direct conversation; see `replyAvatarState`. */
export const directAvatarState = (detail: ChannelDetail) => {
  const { jobs, receiving } = conversationReplies(detail, null);
  return replyAvatarState(jobs, receiving);
};
