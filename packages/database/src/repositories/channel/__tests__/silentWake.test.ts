// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { workspaceMembers } from '../../../schemas';
import { ChannelExecutionRepository, ChannelRoutingRepository } from '..';
import { createChannelFixture, jobById, jobsOf, lease, operationById } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-silent-wake');
const execution = new ChannelExecutionRepository(db);
const routing = new ChannelRoutingRepository(db);

beforeEach(async () => {
  await fixture.setup();
  await db.insert(workspaceMembers).values({
    role: 'member',
    userId: fixture.memberId,
    workspaceId: fixture.workspaceId,
  });
});
afterEach(fixture.cleanup);

const followup = { kind: 'followup' as const, reason: 'followup-window' };

/** A routed message woken for `coder` as a follow-up and for `reviewer` as an owed answer. */
const routed = async (team: Awaited<ReturnType<typeof fixture.createTeamChannel>>) => {
  const coder = await fixture.addAgent(team.channel.id, 'Coder');
  const reviewer = await fixture.addAgent(team.channel.id, 'Reviewer');
  let sequence = 0;
  const send = async () => {
    const content = `Request ${++sequence}`;
    const message = await team.asMember.send(team.channel.id, {
      content,
      requestKey: content,
      routing: 'decision',
    });
    const input = await routing.claim(team.channel.id, message.id);
    await execution.resolveRouting(team.channel.id, message.id, input!.attempt, {
      memberIds: [coder.id, reviewer.id],
      reason: 'test',
      status: 'assigned',
      wakes: { [coder.id]: followup },
    });
    const jobs = await jobsOf(db, message.id);
    return {
      coder: jobs.find((job) => job.memberId === coder.id)!,
      reviewer: jobs.find((job) => job.memberId === reviewer.id)!,
    };
  };
  return { coder, reviewer, send };
};

describe('a follow-up wake that stays silent', () => {
  it('freezes why each member was woken on its job', async () => {
    const team = await fixture.createTeamChannel();
    const { send } = await routed(team);
    const jobs = await send();

    expect(jobs.coder.wake).toEqual(followup);
    expect(jobs.reviewer.wake).toBeNull();
  });

  it('settles as silent, not failed, and keeps the conversation for the next wake', async () => {
    const team = await fixture.createTeamChannel();
    const { send } = await routed(team);
    const first = (await execution.claim(team.channel.id, (await send()).coder.id, lease))!;
    await execution.accepted(team.channel.id, first.job.id);

    expect(await execution.silence(team.channel.id, first.job.id, 'not_addressed')).toBe(true);
    // A repeated completion callback is a no-op that still reports the settled silence.
    expect(await execution.silence(team.channel.id, first.job.id, 'not_addressed')).toBe(true);
    await execution.releaseWriter(team.channel.id, first.job.id);

    const settled = await jobById(db, first.job.id);
    expect(settled).toMatchObject({
      publishedMessageId: null,
      publicationRevoked: false,
      status: 'silent',
      writerHeld: false,
    });
    expect((await operationById(db, settled.operationId)).status).toBe('done');

    const next = (await execution.claim(team.channel.id, (await send()).coder.id, lease))!;
    expect(next.topic.id).toBe(first.topic.id);
  });

  it('never silences a job that owes an answer', async () => {
    const team = await fixture.createTeamChannel();
    const { send } = await routed(team);
    const { job } = (await execution.claim(team.channel.id, (await send()).reviewer.id, lease))!;
    await execution.accepted(team.channel.id, job.id);

    expect(await execution.silence(team.channel.id, job.id, 'not_addressed')).toBe(false);
    expect((await jobById(db, job.id)).status).toBe('running');
  });
});
