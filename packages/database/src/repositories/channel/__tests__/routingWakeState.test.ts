// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelMembers, channels, workspaceMembers } from '../../../schemas';
import { ChannelExecutionRepository, ChannelRoutingRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-routing-wake-state');
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

describe('routing input for the members’ own wake rules', () => {
  it('reports when each member last answered, whom, and its silences since', async () => {
    const team = await fixture.createTeamChannel();
    const coder = await fixture.addAgent(team.channel.id, 'Coder');
    let sequence = 0;
    const send = (routed: boolean) => {
      const content = `Message ${++sequence}`;
      return team.asMember.send(team.channel.id, {
        content,
        mentions: routed ? undefined : [coder.id],
        requestKey: content,
        routing: 'decision',
      });
    };
    const run = async (messageId: string) => {
      const [job] = await jobsOf(db, messageId);
      const claimed = (await execution.claim(team.channel.id, job.id, lease))!;
      await execution.accepted(team.channel.id, claimed.job.id);
      return claimed.job.id;
    };

    const asked = await send(false);
    const answered = await run(asked.id);
    await execution.saveDraft(team.channel.id, answered, 'Fixed it.');
    await execution.publish(team.channel.id, answered);
    await execution.releaseWriter(team.channel.id, answered);

    const followup = await send(true);
    const first = (await routing.claim(team.channel.id, followup.id))!;
    const state = first.candidates.find(({ memberId }) => memberId === coder.id)!;
    expect(state).toMatchObject({ lastReplyToUserId: fixture.memberId, silentWakes: 0 });
    expect(state.lastReplyAt).toBeTypeOf('number');
    expect(first.author.id).toBe(fixture.memberId);
    expect(first.history.at(-1)).toMatchObject({
      authorId: coder.agentId,
      content: 'Fixed it.',
      isAgent: true,
    });

    await execution.resolveRouting(team.channel.id, followup.id, first.attempt, {
      memberIds: [coder.id],
      reason: 'test',
      status: 'assigned',
      wakes: { [coder.id]: { kind: 'followup', reason: 'followup-window' } },
    });
    const silent = await run(followup.id);
    await execution.silence(team.channel.id, silent, 'not_addressed');
    await execution.releaseWriter(team.channel.id, silent);

    const next = await send(true);
    const second = (await routing.claim(team.channel.id, next.id))!;
    expect(second.candidates.find(({ memberId }) => memberId === coder.id)).toMatchObject({
      silentWakes: 1,
    });
  });

  it('counts a silence that settles after the reply it was queued behind', async () => {
    const team = await fixture.createTeamChannel();
    const coder = await fixture.addAgent(team.channel.id, 'Coder');
    let sequence = 0;
    const send = (routed: boolean) => {
      const content = `Message ${++sequence}`;
      return team.asMember.send(team.channel.id, {
        content,
        mentions: routed ? undefined : [coder.id],
        requestKey: content,
        routing: 'decision',
      });
    };
    const run = async (messageId: string) => {
      const [job] = await jobsOf(db, messageId);
      const claimed = (await execution.claim(team.channel.id, job.id, lease))!;
      await execution.accepted(team.channel.id, claimed.job.id);
      return claimed.job.id;
    };

    const asked = await send(false);
    const answered = await run(asked.id);
    await execution.saveDraft(team.channel.id, answered, 'Done.');
    await execution.publish(team.channel.id, answered);
    await execution.releaseWriter(team.channel.id, answered);

    const followup = await send(true);
    const first = (await routing.claim(team.channel.id, followup.id))!;
    await execution.resolveRouting(team.channel.id, followup.id, first.attempt, {
      memberIds: [coder.id],
      reason: 'test',
      status: 'assigned',
      wakes: { [coder.id]: { kind: 'followup', reason: 'followup-window' } },
    });
    const silent = await run(followup.id);
    // Queued while the member was still answering: enqueued before the reply above, but it can
    // only settle once that run has finished — so it must still count against the silent budget.
    await db.execute(
      sql`update channel_jobs set created_at = now() - interval '30 seconds' where id = ${silent}`,
    );
    await execution.silence(team.channel.id, silent, 'not_addressed');
    await execution.releaseWriter(team.channel.id, silent);

    const next = await send(true);
    const second = (await routing.claim(team.channel.id, next.id))!;

    expect(second.candidates.find(({ memberId }) => memberId === coder.id)).toMatchObject({
      silentWakes: 1,
    });
  });

  it('hands over the channel’s and each member’s reply strategy', async () => {
    const team = await fixture.createTeamChannel();
    const coder = await fixture.addAgent(team.channel.id, 'Coder');
    await db
      .update(channels)
      .set({ config: { wake: { pace: 'calm' } } })
      .where(eq(channels.id, team.channel.id));
    const [member] = await db.select().from(channelMembers).where(eq(channelMembers.id, coder.id));
    await db
      .update(channelMembers)
      .set({ config: { ...member.config, wake: { rules: { scope: 'none' } } } })
      .where(eq(channelMembers.id, coder.id));

    const message = await team.asMember.send(team.channel.id, {
      content: 'Anyone?',
      requestKey: 'anyone',
      routing: 'decision',
    });
    const input = (await routing.claim(team.channel.id, message.id))!;

    expect(input.channelWake).toEqual({ pace: 'calm' });
    expect(input.candidates[0].wake).toEqual({ rules: { scope: 'none' } });
  });
});
