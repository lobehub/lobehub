// @vitest-environment node
import type { ChannelInputManifest } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, workspaceMembers } from '../../../schemas';
import type { ChannelRepository } from '..';
import { ChannelExecutionRepository, ChannelRoutingRepository } from '..';
import { readManifestMessages } from '../manifest';
import { createChannelFixture, jobById, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-merge-requests');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const execution = new ChannelExecutionRepository(db);
const routing = new ChannelRoutingRepository(db);

const send = async (
  as: ChannelRepository,
  channelId: string,
  content: string,
  extra: { replyToId?: string } = {},
) => {
  const message = await as.send(channelId, {
    content,
    requestKey: content,
    routing: 'fallback',
    ...extra,
  });
  const [job] = await jobsOf(db, message.id);
  return { job, message };
};

/** Finishes a claimed job with a published reply. */
const finish = async (channelId: string, jobId: string) => {
  await execution.accepted(channelId, jobId);
  await execution.saveDraft(channelId, jobId, 'Answer');
  await execution.publish(channelId, jobId);
  await execution.releaseWriter(channelId, jobId);
};

/** A team Channel whose one Agent is busy answering the owner's first message. */
const busyAgent = async () => {
  const team = await fixture.createTeamChannel();
  await fixture.addAgent(team.channel.id, 'Agent');
  const first = await send(team.asOwner, team.channel.id, 'first');
  await execution.claim(team.channel.id, first.job.id, lease);
  return { ...team, first };
};

describe('Requests one person sends in a row while the Agent is busy', () => {
  it('are answered together in the next run, not one run each', async () => {
    const { asOwner, channel, first } = await busyAgent();
    const second = await send(asOwner, channel.id, 'second');
    const third = await send(asOwner, channel.id, 'third');
    const fourth = await send(asOwner, channel.id, 'fourth');

    await finish(channel.id, first.job.id);
    const claim = await execution.claim(channel.id, second.job.id, lease);

    expect(claim?.job.manifest).toMatchObject({
      cutoffSequence: fourth.message.sequence,
      requestMessageId: fourth.message.id,
      requestMessageIds: [second.message.id, third.message.id, fourth.message.id],
    });
    expect((await jobById(db, third.job.id)).status).toBe('merged');
    expect((await jobById(db, fourth.job.id)).status).toBe('merged');
    expect(
      (await execution.input(channel.id, second.job.id)).map(({ content }) => content),
    ).toEqual(['second', 'third', 'fourth']);
    // Nothing is left queued behind the merged run.
    expect(
      (await asOwner.detail(channel.id)).jobs.filter((job) => job.status === 'queued'),
    ).toEqual([]);
  });

  it('stops merging at a request from someone else', async () => {
    const { asMember, asOwner, channel, first } = await busyAgent();
    const second = await send(asOwner, channel.id, 'second');
    const other = await send(asMember, channel.id, 'from the member');
    const third = await send(asOwner, channel.id, 'third');

    await finish(channel.id, first.job.id);
    const claim = await execution.claim(channel.id, second.job.id, lease);

    expect(claim?.job.manifest?.requestMessageId).toBe(second.message.id);
    expect(claim?.job.manifest?.requestMessageIds).toBeUndefined();
    expect((await jobById(db, other.job.id)).status).toBe('queued');
    expect((await jobById(db, third.job.id)).status).toBe('queued');
  });

  it('opens one reply for the batch, not one per request', async () => {
    const { asOwner, channel } = await busyAgent();
    const second = await send(asOwner, channel.id, 'second');
    const third = await send(asOwner, channel.id, 'third');

    expect(await execution.openingCandidate(channel.id, second.job.id)).toBeDefined();
    expect(await execution.openingCandidate(channel.id, third.job.id)).toBeUndefined();
  });

  it('queues the merged requests again when their run is retried', async () => {
    const team = await fixture.createTeamChannel();
    await fixture.addAgent(team.channel.id, 'Device Agent');
    const first = await send(team.asOwner, team.channel.id, 'first');
    const second = await send(team.asOwner, team.channel.id, 'second');
    const claim = await execution.claim(team.channel.id, first.job.id, lease);
    expect(claim?.job.manifest?.requestMessageIds).toEqual([first.message.id, second.message.id]);

    await db
      .update(agentOperations)
      .set({
        error: { message: 'offline', type: 'DeviceGatewayNotConfigured' },
        status: 'error',
      })
      .where(eq(agentOperations.id, claim!.job.operationId!));
    await execution.fail(team.channel.id, first.job.id, { message: 'Agent could not start' });
    await execution.releaseWriter(team.channel.id, first.job.id);
    await team.asOwner.retryJob(team.channel.id, first.job.id);

    expect((await jobById(db, second.job.id)).status).toBe('queued');
    const again = await execution.claim(team.channel.id, first.job.id, lease);
    expect(again?.job.manifest?.requestMessageIds).toEqual([first.message.id, second.message.id]);
  });
});

describe('a deferred follow-up whose request an earlier run answers', () => {
  it('waits for the merged answer and then reads it', async () => {
    const team = await fixture.createTeamChannel();
    // Routing asks the workspace who the sender is.
    await db.insert(workspaceMembers).values({
      role: 'owner',
      userId: fixture.ownerId,
      workspaceId: fixture.workspaceId,
    });
    const coder = await fixture.addAgent(team.channel.id, 'Coder');
    const reviewer = await fixture.addAgent(team.channel.id, 'Reviewer');

    /** One request routed by decision, with the reviewers it wakes. */
    const ask = async (content: string, deferredBehind?: string) => {
      const message = await team.asOwner.send(team.channel.id, {
        content,
        requestKey: content,
        routing: 'decision',
      });
      const input = await routing.claim(team.channel.id, message.id);
      await execution.resolveRouting(team.channel.id, message.id, input!.attempt, {
        memberIds: deferredBehind ? [coder.id, reviewer.id] : [coder.id],
        reason: 'test',
        status: 'assigned',
        ...(deferredBehind && {
          wakes: {
            [reviewer.id]: {
              afterMemberId: deferredBehind,
              kind: 'followup',
              reason: 'routing-deferred',
            },
          },
        }),
      });
      return message;
    };

    const first = await ask('first');
    // The reviewer is deferred behind the coder only for this later request.
    const second = await ask('second', coder.id);
    const secondJobs = await jobsOf(db, second.id);
    const secondPrimary = secondJobs.find((job) => job.memberId === coder.id)!;
    const secondFollowUp = secondJobs.find((job) => job.memberId === reviewer.id)!;

    const firstJob = (await jobsOf(db, first.id)).find((job) => job.memberId === coder.id)!;
    const claim = await execution.claim(team.channel.id, firstJob.id, lease);
    // The earlier run answers both requests, so the later primary settles as merged.
    expect(claim?.job.manifest?.requestMessageIds).toEqual([first.id, second.id]);
    expect((await jobById(db, secondPrimary.id)).status).toBe('merged');

    // Its request is still owed an answer — the batch's — so the follow-up keeps waiting.
    expect(await execution.claim(team.channel.id, secondFollowUp.id, lease)).toBeNull();
    expect((await jobById(db, secondFollowUp.id)).blockedCode).toBe('awaiting_primary');

    await finish(team.channel.id, claim!.job.id);

    // Then it runs, with the batch's answer in view.
    expect(await execution.claim(team.channel.id, secondFollowUp.id, lease)).not.toBeNull();
    expect(await execution.primaryReply(team.channel.id, secondFollowUp.id)).toMatchObject({
      content: 'Answer',
    });
  });
});

describe('a Thread whose root an earlier run merged', () => {
  it('starts only after that run answers the root', async () => {
    const team = await fixture.createTeamChannel();
    // Routing asks the workspace who the sender is.
    await db.insert(workspaceMembers).values({
      role: 'owner',
      userId: fixture.ownerId,
      workspaceId: fixture.workspaceId,
    });
    const agent = await fixture.addAgent(team.channel.id, 'Agent');

    /** One request on the given timeline, routed to the Agent by decision. */
    const ask = async (content: string, threadId?: string) => {
      const message = await team.asOwner.send(team.channel.id, {
        content,
        requestKey: content,
        routing: 'decision',
        ...(threadId && { threadId }),
      });
      const input = await routing.claim(team.channel.id, message.id);
      await execution.resolveRouting(team.channel.id, message.id, input!.attempt, {
        memberIds: [agent.id],
        reason: 'test',
        status: 'assigned',
      });
      return message;
    };

    const root = await ask('root');
    const later = await ask('later');
    const rootJob = (await jobsOf(db, root.id)).find((job) => job.memberId === agent.id)!;
    const laterJob = (await jobsOf(db, later.id)).find((job) => job.memberId === agent.id)!;

    // The Agent answers both main-timeline requests in one run, so the later one is merged.
    const claim = await execution.claim(team.channel.id, rootJob.id, lease);
    expect(claim?.job.manifest?.requestMessageIds).toEqual([root.id, later.id]);
    expect((await jobById(db, laterJob.id)).status).toBe('merged');

    // A Thread hangs off the merged request; that request is still owed the same run's answer.
    const thread = await team.asOwner.createThread(team.channel.id, { rootMessageId: later.id });
    const inThread = await ask('in the thread', thread.id);
    const threadJob = (await jobsOf(db, inThread.id)).find((job) => job.memberId === agent.id)!;

    expect(await execution.claim(team.channel.id, threadJob.id, lease)).toBeNull();
    expect((await jobById(db, threadJob.id)).blockedCode).toBe('member_busy');

    await finish(team.channel.id, claim!.job.id);

    expect(await execution.claim(team.channel.id, threadJob.id, lease)).not.toBeNull();
  });
});

describe('the scope of a batch continued into a Thread', () => {
  it('keeps what an earlier request of the batch quotes', async () => {
    const team = await fixture.createTeamChannel();
    const agent = await fixture.addAgent(team.channel.id, 'Agent');
    const root = await send(team.asOwner, team.channel.id, 'thread root');
    // Quoted by the first request; posted on the main timeline after the Thread's root.
    const quote = await send(team.asOwner, team.channel.id, 'the log I mean');
    const first = await send(team.asOwner, team.channel.id, 'first request', {
      replyToId: quote.message.id,
    });
    const last = await send(team.asOwner, team.channel.id, 'last request');

    // The branch the two requests were continued into, as the merged run freezes it.
    const manifest: ChannelInputManifest = {
      cutoffSequence: last.message.sequence,
      requestMessageId: last.message.id,
      requestMessageIds: [first.message.id, last.message.id],
      requesterMemberId: agent.id,
      self: { agentId: agent.agentId!, memberId: agent.id, name: 'Agent' },
      threadId: 'thread-the-requests-were-continued-in',
      threadRootSequence: root.message.sequence,
    };

    expect(
      (
        await readManifestMessages(db, team.channel.id, manifest, {
          messageIds: [quote.message.id],
        })
      ).map(({ content }) => content),
    ).toEqual(['the log I mean']);
  });
});
