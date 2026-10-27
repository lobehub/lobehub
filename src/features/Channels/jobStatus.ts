import type { ChannelPublicJob } from '@lobechat/types';

export const channelJobStatus = (job: ChannelPublicJob) =>
  job.publicationRevoked && job.writerHeld
    ? 'status.stopping'
    : job.status === 'queued'
      ? job.blockedCode
        ? (`blocked.${job.blockedCode}` as const)
        : 'status.preparing'
      : (`status.${job.status}` as const);

/** Colour family of a status: working blue, attention amber, error red, settled grey. */
export type ChannelStatusTone = 'attention' | 'done' | 'error' | 'quiet' | 'working';

export const channelJobTone = (job: ChannelPublicJob): ChannelStatusTone => {
  if (job.status === 'failed') return 'error';
  if (job.publicationRevoked) return job.writerHeld ? 'attention' : 'quiet';
  if (job.status === 'queued') return job.blockedCode ? 'attention' : 'working';
  if (job.status === 'running') return 'working';
  if (job.status === 'completed') return 'done';
  return 'quiet';
};

/** Still able to publish a reply, so the user can stop it. */
export const isChannelJobActive = (job: ChannelPublicJob) =>
  !job.publicationRevoked && (job.status === 'queued' || job.status === 'running');

/** Work the conversation is still waiting on: shown above the composer, not on messages. */
export const replyActivityJobs = (jobs: ChannelPublicJob[]) =>
  jobs.filter((job) => isChannelJobActive(job) || (job.publicationRevoked && job.writerHeld));

/**
 * Each member's newest job when it failed. A later reply, stop or retry by the same member
 * settles the failure, so the header does not stay red forever. Jobs arrive newest first.
 */
export const unresolvedFailures = (jobs: ChannelPublicJob[]) => {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    if (seen.has(job.memberId)) return false;
    seen.add(job.memberId);
    return job.status === 'failed';
  });
};

/** What a member is busy with now: a running reply first, then the next queued one. */
export const memberCurrentJob = (jobs: ChannelPublicJob[], memberId: string) => {
  const own = jobs.filter((job) => job.memberId === memberId);
  return (
    own.find((job) => isChannelJobActive(job) && job.status === 'running') ??
    own.find(isChannelJobActive) ??
    own.find((job) => job.publicationRevoked && job.writerHeld) ??
    unresolvedFailures(own)[0]
  );
};
