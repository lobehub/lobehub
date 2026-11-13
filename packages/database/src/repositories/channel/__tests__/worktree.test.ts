// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMembers } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ChannelExecutionRepository } from '..';
import { worktreeBranch } from '../worktree';
import { createChannelFixture, deviceConfig, jobById, jobsOf, lease } from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-worktree');
const execution = new ChannelExecutionRepository(db);

beforeEach(fixture.setup);
afterEach(fixture.cleanup);

/** Two Agents configured on the same device directory, both mentioned at once. */
const sharedDirectory = async () => {
  const { asMember, channel } = await fixture.createTeamChannel();
  const first = await fixture.addAgent(channel.id, 'First', deviceConfig());
  const second = await fixture.addAgent(channel.id, 'Second', deviceConfig());
  const message = await asMember.send(channel.id, {
    content: 'Both of you',
    mentions: [first.id, second.id],
    requestKey: 'req-1',
    routing: 'decision',
  });
  const jobs = await jobsOf(db, message.id);
  const firstJob = jobs.find((job) => job.memberId === first.id)!;
  const secondJob = jobs.find((job) => job.memberId === second.id)!;
  expect(await execution.claim(channel.id, firstJob.id, lease)).not.toBeNull();
  expect(await execution.claim(channel.id, secondJob.id, lease)).toBeNull();
  return { asMember, channel, first, firstJob, second, secondJob };
};

const memberMetadata = async (memberId: string) => {
  const [member] = await db.select().from(channelMembers).where(eq(channelMembers.id, memberId));
  return member.metadata;
};

describe('channel worktrees', () => {
  it('offers a job blocked by another run in its directory for a worktree', async () => {
    const { channel, second, secondJob } = await sharedDirectory();

    expect(await execution.worktreeCandidate(channel.id, secondJob.id)).toEqual({
      branch: expect.stringMatching(
        new RegExp(`^lobe-channel/${second.id.replaceAll('-', '').slice(0, 12)}-main-[\\da-f]{8}$`),
      ),
      deviceId: 'device-1',
      deviceUserId: fixture.memberId,
      memberId: second.id,
      sourceDirectory: '/repo',
      threadId: null,
    });
  });

  it('runs the branch in its worktree once assigned, under its own directory lock', async () => {
    const { channel, second, secondJob } = await sharedDirectory();
    const candidate = (await execution.worktreeCandidate(channel.id, secondJob.id))!;

    expect(await execution.assignWorktree(channel.id, candidate, '/home/.lobehub/wt')).toBe(true);
    const claim = await execution.claim(channel.id, secondJob.id, lease);

    expect(claim?.job).toMatchObject({
      blockedCode: null,
      status: 'running',
      workingDirectory: '/home/.lobehub/wt',
      writerHeld: true,
    });
    expect(claim?.job.executionConfig).toMatchObject({
      workingDirectory: '/home/.lobehub/wt',
      worktreeBranch: candidate.branch,
    });
    // The branch has its worktree now; nothing more to create.
    expect(await memberMetadata(second.id)).toMatchObject({
      worktrees: { main: { branch: candidate.branch, path: '/home/.lobehub/wt' } },
    });
  });

  it('keeps the branch on its worktree for later replies', async () => {
    const { asMember, channel, second, secondJob } = await sharedDirectory();
    const candidate = (await execution.worktreeCandidate(channel.id, secondJob.id))!;
    await execution.assignWorktree(channel.id, candidate, '/home/.lobehub/wt');
    await execution.claim(channel.id, secondJob.id, lease);
    await execution.releaseWriter(channel.id, secondJob.id);

    const next = await asMember.send(channel.id, {
      content: 'Again',
      mentions: [second.id],
      requestKey: 'req-2',
      routing: 'decision',
    });
    const [nextJob] = await jobsOf(db, next.id);
    const claim = await execution.claim(channel.id, nextJob.id, lease);

    expect(claim?.job.workingDirectory).toBe('/home/.lobehub/wt');
  });

  it('ignores a worktree cut from a directory the member no longer uses', async () => {
    const { channel, second, secondJob } = await sharedDirectory();
    const candidate = (await execution.worktreeCandidate(channel.id, secondJob.id))!;
    await db
      .update(channelMembers)
      .set({ config: { deviceId: 'device-1', workingDirectory: '/other' } })
      .where(eq(channelMembers.id, second.id));

    expect(await execution.assignWorktree(channel.id, candidate, '/home/.lobehub/wt')).toBe(false);
    const claim = await execution.claim(channel.id, secondJob.id, lease);
    expect(claim?.job.workingDirectory).toBe('/other');
  });

  it('leaves a directory that cannot host a worktree alone for a while', async () => {
    const { channel, secondJob } = await sharedDirectory();
    const candidate = (await execution.worktreeCandidate(channel.id, secondJob.id))!;

    await execution.worktreeUnavailable(channel.id, candidate, 'not a git repository');

    expect(await execution.worktreeCandidate(channel.id, secondJob.id)).toBeUndefined();
    expect(await jobById(db, secondJob.id)).toMatchObject({
      blockedCode: 'directory_locked',
      status: 'queued',
    });
  });

  it('does not offer a job that waits on something other than its directory', async () => {
    const { channel, firstJob } = await sharedDirectory();

    expect(await execution.worktreeCandidate(channel.id, firstJob.id)).toBeUndefined();
  });

  it("names a later environment's worktree apart from the branch an earlier one created", () => {
    const first = worktreeBranch('member-1', null, 'device-1', '/repo');

    expect(worktreeBranch('member-1', null, 'device-1', '/repo')).toBe(first);
    expect(worktreeBranch('member-1', null, 'device-1', '/repo-other-checkout')).not.toBe(first);
    expect(worktreeBranch('member-1', null, 'device-2', '/repo')).not.toBe(first);
  });
});
