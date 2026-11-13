import type { ChannelPublicJob } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  channelJobStatus,
  channelJobTone,
  directAvatarState,
  hasReplyActivity,
  memberCurrentJob,
  memberJobStatus,
  replyActivityJobs,
  replyAvatarState,
  unresolvedFailures,
} from './jobStatus';

describe('memberJobStatus', () => {
  it('words a running reply as work and leaves other statuses alone', () => {
    expect(memberJobStatus({ status: 'running' } as never)).toBe('status.working');
    expect(memberJobStatus({ status: 'queued' } as never)).toBe('status.preparing');
  });
});

describe('Channel task status', () => {
  const job = (patch: Partial<ChannelPublicJob>) =>
    ({
      blockedCode: 'directory_locked',
      publicationRevoked: false,
      status: 'queued',
      writerHeld: false,
      ...patch,
    }) as ChannelPublicJob;
  it('shows a cancelled queued task as stopped even when its last blocking reason is retained', () => {
    expect(channelJobStatus(job({ status: 'cancelled', publicationRevoked: true }))).toBe(
      'status.cancelled',
    );
  });
  it('keeps termination pending until the device confirms the writer has stopped', () => {
    expect(
      channelJobStatus(job({ status: 'cancelled', publicationRevoked: true, writerHeld: true })),
    ).toBe('status.stopping');
  });
  it('shows a newly queued task as preparing, not waiting behind another Agent', () => {
    expect(channelJobStatus(job({ blockedCode: null }))).toBe('status.preparing');
  });
  it('explains when an earlier reply from the same Agent must finish first', () => {
    expect(channelJobStatus(job({ blockedCode: 'member_busy' }))).toBe('blocked.member_busy');
  });
  it('explains why a queued task is waiting', () => {
    expect(channelJobStatus(job({}))).toBe('blocked.directory_locked');
  });
});

describe('Channel task tone', () => {
  const job = (patch: Partial<ChannelPublicJob>) =>
    ({
      blockedCode: null,
      id: 'job',
      memberId: 'member',
      publicationRevoked: false,
      status: 'queued',
      writerHeld: false,
      ...patch,
    }) as ChannelPublicJob;

  it('marks blocked and still-stopping work for attention', () => {
    expect(channelJobTone(job({ blockedCode: 'device_offline' }))).toBe('attention');
    expect(channelJobTone(job({ publicationRevoked: true, writerHeld: true }))).toBe('attention');
  });

  it('settles a stopped task even while its last status is still running', () => {
    expect(channelJobTone(job({ publicationRevoked: true, status: 'running' }))).toBe('quiet');
  });

  it('separates working, finished and failed replies', () => {
    expect(channelJobTone(job({ status: 'running' }))).toBe('working');
    expect(channelJobTone(job({ status: 'completed' }))).toBe('done');
    expect(channelJobTone(job({ status: 'failed' }))).toBe('error');
  });

  it('keeps a failure visible after its publication was revoked', () => {
    expect(channelJobTone(job({ publicationRevoked: true, status: 'failed' }))).toBe('error');
  });

  it('shows only unfinished work as reply activity in a mixed reply group', () => {
    const jobs = [
      job({ id: 'done', status: 'completed' }),
      job({ id: 'preparing' }),
      job({ id: 'waiting', blockedCode: 'directory_locked' }),
      job({ id: 'running', status: 'running' }),
      job({ id: 'stopping', status: 'cancelled', publicationRevoked: true, writerHeld: true }),
      job({ id: 'failed', status: 'failed' }),
      job({ id: 'failed-revoked', status: 'failed', publicationRevoked: true }),
      job({ id: 'cancelled', status: 'cancelled' }),
      job({ id: 'stopped', status: 'running', publicationRevoked: true }),
    ];
    expect(replyActivityJobs(jobs).map((entry) => entry.id)).toEqual([
      'preparing',
      'waiting',
      'running',
      'stopping',
    ]);
  });

  it('does not show a follow-up deferred behind the primary responder as replying', () => {
    const deferred = job({ blockedCode: 'awaiting_primary', id: 'deferred' });
    expect(replyActivityJobs([job({ id: 'primary', status: 'running' }), deferred])).toEqual([
      expect.objectContaining({ id: 'primary' }),
    ]);
    expect(channelJobTone(deferred)).toBe('quiet');
    expect(channelJobStatus(deferred)).toBe('blocked.awaiting_primary');
    // Once it starts, it is a reply in progress like any other.
    expect(replyActivityJobs([{ ...deferred, blockedCode: null, status: 'running' }])).toHaveLength(
      1,
    );
  });

  it('leaves no reply activity when all three Agents have replied', () => {
    expect(
      replyActivityJobs(['codex', 'pi', 'native'].map((id) => job({ id, status: 'completed' }))),
    ).toEqual([]);
  });

  it('removes activity immediately after publication without waiting for writer cleanup', () => {
    expect(replyActivityJobs([job({ status: 'completed', writerHeld: true })])).toEqual([]);
  });

  it('removes stopping feedback only when physical exit is confirmed', () => {
    const stopping = job({ status: 'cancelled', publicationRevoked: true, writerHeld: true });
    expect(replyActivityJobs([stopping])).toEqual([stopping]);
    expect(replyActivityJobs([{ ...stopping, writerHeld: false }])).toEqual([]);
  });

  it("picks a member's running reply before its queued ones", () => {
    const jobs = [
      job({ id: 'done', status: 'completed' }),
      job({ id: 'next' }),
      job({ id: 'now', status: 'running' }),
      job({ id: 'other', memberId: 'someone', status: 'running' }),
    ];
    expect(memberCurrentJob(jobs, 'member')?.id).toBe('now');
    expect(memberCurrentJob(jobs.slice(0, 2), 'member')?.id).toBe('next');
    expect(memberCurrentJob(jobs.slice(0, 1), 'member')).toBeUndefined();
  });

  it("flags a member's failure until a newer reply from it settles", () => {
    const failed = job({ id: 'failed', status: 'failed' });
    expect(memberCurrentJob([failed], 'member')?.id).toBe('failed');
    expect(memberCurrentJob([job({ id: 'later', status: 'completed' }), failed], 'member')).toBe(
      undefined,
    );
  });

  it('keeps only failures that are each member’s newest job', () => {
    const jobs = [
      job({ id: 'a-retry', memberId: 'a', status: 'completed' }),
      job({ id: 'b-failed', memberId: 'b', status: 'failed' }),
      job({ id: 'a-failed', memberId: 'a', status: 'failed' }),
      job({ id: 'b-older', memberId: 'b', status: 'failed' }),
      job({ id: 'c-stopped', memberId: 'c', status: 'cancelled', publicationRevoked: true }),
    ];
    expect(unresolvedFailures(jobs).map((entry) => entry.id)).toEqual(['b-failed']);
  });
});

describe('directAvatarState', () => {
  const job = (patch: Partial<ChannelPublicJob> = {}) =>
    ({
      id: 'job_1',
      memberId: 'mem_cook',
      publicationRevoked: false,
      status: 'running',
      threadId: null,
      writerHeld: false,
      ...patch,
    }) as ChannelPublicJob;
  const detail = (jobs: ChannelPublicJob[], messages: unknown[] = []) =>
    ({ channel: { agentId: 'agt_cook', id: 'chn_cook' }, jobs, members: [], messages }) as never;

  it('works while the Agent writes its reply', () => {
    expect(directAvatarState(detail([job()]))).toBe('working');
  });

  it('thinks while a message is routed or the reply is prepared', () => {
    expect(directAvatarState(detail([], [{ routingStatus: 'pending' }]))).toBe('thinking');
    expect(directAvatarState(detail([job({ blockedCode: undefined, status: 'queued' })]))).toBe(
      'thinking',
    );
  });

  it('waits when the reply is blocked or stopping', () => {
    expect(
      directAvatarState(detail([job({ blockedCode: 'device_offline', status: 'queued' })])),
    ).toBe('waiting');
    expect(
      directAvatarState(
        detail([job({ publicationRevoked: true, status: 'cancelled', writerHeld: true })]),
      ),
    ).toBe('waiting');
  });

  it('stays idle once the conversation settles', () => {
    expect(directAvatarState(detail([job({ status: 'completed' })]))).toBeUndefined();
    expect(directAvatarState(detail([job({ threadId: 'thr_1' })]))).toBeUndefined();
  });
});

describe('replyAvatarState', () => {
  const job = (patch: Partial<ChannelPublicJob> = {}) =>
    ({
      blockedCode: null,
      id: 'job_1',
      memberId: 'mem_cook',
      publicationRevoked: false,
      status: 'running',
      threadId: null,
      writerHeld: true,
      ...patch,
    }) as ChannelPublicJob;

  it('prefers the running reply over a queued one of the same Agent', () => {
    expect(replyAvatarState([job({ id: 'next', status: 'queued' }), job()])).toBe('working');
  });

  it('ignores settled replies and stays idle without any', () => {
    expect(replyAvatarState([job({ status: 'failed', writerHeld: false })])).toBeUndefined();
    expect(replyAvatarState([])).toBeUndefined();
  });
});

describe('hasReplyActivity', () => {
  const detail = (patch: { jobs?: unknown[]; messages?: unknown[] }) =>
    ({ jobs: [], messages: [], ...patch }) as never;

  it('is false when nothing is pending, so the composer keeps no empty status strip', () => {
    expect(hasReplyActivity(detail({}), null)).toBe(false);
    expect(
      hasReplyActivity(
        detail({ jobs: [{ publicationRevoked: false, status: 'completed', threadId: null }] }),
        null,
      ),
    ).toBe(false);
  });

  it('is true while a reply runs or a sent message awaits routing', () => {
    expect(
      hasReplyActivity(
        detail({ jobs: [{ publicationRevoked: false, status: 'running', threadId: null }] }),
        null,
      ),
    ).toBe(true);
    expect(hasReplyActivity(detail({ messages: [{ routingStatus: 'pending' }] }), null)).toBe(true);
  });

  it('only counts replies in the given thread', () => {
    const running = detail({
      jobs: [{ publicationRevoked: false, status: 'running', threadId: 'thread-a' }],
    });
    expect(hasReplyActivity(running, 'thread-a')).toBe(true);
    expect(hasReplyActivity(running, null)).toBe(false);
  });
});
