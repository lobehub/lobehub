import type { ChannelDetail, ChannelReplyJob } from '@lobechat/types';
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
 * settles the failure, so the header does not stay red forever. Jobs arrive newest first.
 */
export const unresolvedFailures = <T extends ChannelReplyJob>(jobs: T[]) => {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    if (seen.has(job.memberId)) return false;
    seen.add(job.memberId);
    return job.status === 'failed';
  });
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
