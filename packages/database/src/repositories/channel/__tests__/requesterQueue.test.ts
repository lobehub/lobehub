// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { channelAudit, channelJobs } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import type { ChannelRepository } from '..';
import { ChannelExecutionRepository } from '..';
import { PUBLICATION_REVOKED_EVENT } from '../writer';
import {
  createChannelFixture,
  deviceConfig,
  jobById,
  jobsOf,
  lease,
  operationById,
} from './testUtils';

const db: LobeChatDatabase = await getTestDB();
const fixture = createChannelFixture(db, 'channel-requester-queue');
const execution = new ChannelExecutionRepository(db);

beforeEach(fixture.setup);
afterEach(fixture.cleanup);

/** A Claude Code Agent with no device picked in the Channel: each run goes to its requester's. */
const unpickedConfig = { model: 'claude', provider: 'anthropic', runtime: 'claude-code' as const };

/** A team channel with one Agent that both the owner and a member can ask. */
const team = async (config: Parameters<typeof fixture.addAgent>[2]) => {
  const channel = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(channel.channel.id, 'Justin', config);
  let sent = 0;
  const ask = async (as: ChannelRepository, threadId?: string) => {
    sent += 1;
    const message = await as.send(channel.channel.id, {
      content: `Request ${sent}`,
      mentions: [agent.id],
      requestKey: `ask-${sent}`,
      routing: 'decision',
      ...(threadId && { threadId }),
    });
    const [job] = await jobsOf(db, message.id);
    return { job, message };
  };
  return { ...channel, agent, ask };
};

describe('per-requester queues', () => {
  it("runs two people's requests to one Agent in the same branch side by side", async () => {
    const { asMember, asOwner, ask, channel } = await team(unpickedConfig);
    const first = await ask(asMember);
    const second = await ask(asOwner);

    // Each person's request heads its own queue.
    const { heads } = await execution.candidates(channel.id);
    expect(heads.map((job) => job.id).sort()).toEqual([first.job.id, second.job.id].sort());

    // A later request from someone else neither waits for the earlier head nor for its writer.
    expect(await execution.claim(channel.id, second.job.id, lease)).not.toBeNull();
    expect(await execution.claim(channel.id, first.job.id, lease)).not.toBeNull();
    expect(await jobById(db, first.job.id)).toMatchObject({ blockedCode: null, status: 'running' });
    expect(await jobById(db, second.job.id)).toMatchObject({
      blockedCode: null,
      status: 'running',
    });
  });

  it("still answers one person's requests in order, one at a time", async () => {
    const { asMember, asOwner, ask, channel } = await team(unpickedConfig);
    const first = await ask(asMember);
    const second = await ask(asMember);
    const other = await ask(asOwner);

    expect(await execution.claim(channel.id, second.job.id, lease)).toBeNull();
    expect(await jobById(db, second.job.id)).toMatchObject({ blockedCode: 'member_busy' });
    expect(await execution.claim(channel.id, first.job.id, lease)).not.toBeNull();
    expect(await execution.claim(channel.id, second.job.id, lease)).toBeNull();
    expect(await jobById(db, second.job.id)).toMatchObject({ blockedCode: 'member_busy' });
    // The other person is not held back by either.
    expect(await execution.claim(channel.id, other.job.id, lease)).not.toBeNull();

    expect(await execution.retireReservation(channel.id, first.job.id)).toBe(true);
    expect(await execution.claim(channel.id, second.job.id, lease)).not.toBeNull();
  });

  // Every run of the member shares the picked device and directory, so the member takes turns.
  it('keeps the whole member taking turns on a device picked in the Channel', async () => {
    const { asMember, asOwner, ask, channel } = await team(deviceConfig());
    const first = await ask(asMember);
    const second = await ask(asOwner);

    expect(await execution.claim(channel.id, second.job.id, lease)).toBeNull();
    expect(await jobById(db, second.job.id)).toMatchObject({ blockedCode: 'member_busy' });
    expect(await execution.claim(channel.id, first.job.id, lease)).not.toBeNull();
    expect(await execution.claim(channel.id, second.job.id, lease)).toBeNull();
    expect(await jobById(db, second.job.id)).toMatchObject({ blockedCode: 'member_busy' });

    expect(await execution.retireReservation(channel.id, first.job.id)).toBe(true);
    expect(await execution.claim(channel.id, second.job.id, lease)).not.toBeNull();
  });

  // A Thread's runs read the member's answer to its root, whoever asked in the Thread.
  it("starts anyone's Thread request only after the member answered its root", async () => {
    const { asMember, asOwner, ask, channel } = await team(unpickedConfig);
    const root = await ask(asMember);
    const thread = await asOwner.createThread(channel.id, { rootMessageId: root.message.id });
    const inThread = await ask(asOwner, thread.id);

    expect(await execution.claim(channel.id, inThread.job.id, lease)).toBeNull();
    expect(await jobById(db, inThread.job.id)).toMatchObject({ blockedCode: 'member_busy' });
    expect(await execution.claim(channel.id, root.job.id, lease)).not.toBeNull();
    expect(await execution.claim(channel.id, inThread.job.id, lease)).toBeNull();

    expect(await execution.retireReservation(channel.id, root.job.id)).toBe(true);
    expect(await execution.claim(channel.id, inThread.job.id, lease)).not.toBeNull();
  });
});

describe('a stop the device never confirms', () => {
  /** Claims, starts and stops the member's request; its writer stays held. */
  const stopped = async () => {
    const state = await team(unpickedConfig);
    const first = await state.ask(state.asMember);
    const next = await state.ask(state.asMember);
    await execution.claim(state.channel.id, first.job.id, lease);
    await execution.accepted(state.channel.id, first.job.id);
    await execution.finishDispatch(state.channel.id, first.job.id, lease.leaseOwner);
    await execution.stop(state.channel.id, { jobId: first.job.id });
    return { ...state, first, next };
  };

  /** Moves the job's claim and revocation `ms` into the past. */
  const backdate = async (jobId: string, ms: number, event = 'stop_requested') => {
    await db
      .update(channelJobs)
      .set({ claimedAt: new Date(Date.now() - ms - 1000) })
      .where(eq(channelJobs.id, jobId));
    await db
      .update(channelAudit)
      .set({ createdAt: new Date(Date.now() - ms) })
      .where(and(eq(channelAudit.targetId, jobId), eq(channelAudit.event, event)));
  };

  it('keeps holding the queue until the timeout has passed', async () => {
    const { channel, first, next } = await stopped();

    expect(await execution.isolateUnconfirmedStop(channel.id, first.job.id, 120_000)).toBe(false);
    expect(await jobById(db, first.job.id)).toMatchObject({
      isolatedAt: null,
      status: 'cancelled',
      writerHeld: true,
    });
    expect(await execution.claim(channel.id, next.job.id, lease)).toBeNull();
  });

  it('isolates the writer after the timeout so the queue moves on', async () => {
    const { channel, first, next } = await stopped();
    await backdate(first.job.id, 180_000);

    expect(await execution.isolateUnconfirmedStop(channel.id, first.job.id, 120_000)).toBe(true);
    const job = await jobById(db, first.job.id);
    // Still cancelled and still holding the writer: only the device's confirmation releases it.
    expect(job).toMatchObject({
      isolatedAt: expect.any(Date),
      publicationRevoked: true,
      status: 'cancelled',
      writerHeld: true,
    });
    expect(await operationById(db, job.operationId)).toMatchObject({ status: 'abandoned' });
    expect(await execution.claim(channel.id, next.job.id, lease)).not.toBeNull();

    // Once only.
    expect(await execution.isolateUnconfirmedStop(channel.id, first.job.id, 120_000)).toBe(false);
    // A late confirmation still releases the writer and keeps the stop's outcome.
    await execution.releaseWriter(channel.id, first.job.id);
    expect(await jobById(db, first.job.id)).toMatchObject({
      status: 'cancelled',
      writerHeld: false,
    });
  });

  it('times a branch stop from the per-job revocation', async () => {
    const state = await team(unpickedConfig);
    const first = await state.ask(state.asMember);
    await execution.claim(state.channel.id, first.job.id, lease);
    await execution.finishDispatch(state.channel.id, first.job.id, lease.leaseOwner);
    await execution.stop(state.channel.id, { threadId: null });

    const [revoked] = await db
      .select()
      .from(channelAudit)
      .where(
        and(
          eq(channelAudit.targetId, first.job.id),
          eq(channelAudit.event, PUBLICATION_REVOKED_EVENT),
        ),
      );
    expect(revoked).toBeDefined();
    expect(await execution.isolateUnconfirmedStop(state.channel.id, first.job.id, 120_000)).toBe(
      false,
    );
    await backdate(first.job.id, 180_000, PUBLICATION_REVOKED_EVENT);
    expect(await execution.isolateUnconfirmedStop(state.channel.id, first.job.id, 120_000)).toBe(
      true,
    );
  });

  it('waits for a dispatcher that still holds its lease', async () => {
    const state = await team(unpickedConfig);
    const first = await state.ask(state.asMember);
    await execution.claim(state.channel.id, first.job.id, lease);
    await execution.stop(state.channel.id, { jobId: first.job.id });
    await backdate(first.job.id, 180_000);

    expect(await execution.isolateUnconfirmedStop(state.channel.id, first.job.id, 120_000)).toBe(
      false,
    );
  });

  it('leaves a running, unstopped writer alone', async () => {
    const state = await team(unpickedConfig);
    const first = await state.ask(state.asMember);
    await execution.claim(state.channel.id, first.job.id, lease);
    await execution.finishDispatch(state.channel.id, first.job.id, lease.leaseOwner);

    expect(await execution.isolateUnconfirmedStop(state.channel.id, first.job.id, 0)).toBe(false);
  });
});
