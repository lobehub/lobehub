// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, agents, channelMessages, workspaceMembers } from '../../../schemas';
import {
  ChannelError,
  ChannelExecutionRepository,
  ChannelHistoryRepository,
  ChannelRepository,
} from '..';
import { readManifestMessages } from '../manifest';
import { createChannelFixture, jobsOf, lease, nativeConfig } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-agent-pair');
const execution = new ChannelExecutionRepository(db);
beforeEach(async () => {
  await fixture.setup();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: fixture.workspaceId, userId: fixture.ownerId });
});
afterEach(fixture.cleanup);

const origin = { channelId: 'channel-origin', threadId: null };

const setup = async () => {
  const [asker, answerer] = await db
    .insert(agents)
    .values(
      ['Asker', 'Answerer'].map((name) => ({
        model: nativeConfig.model,
        name,
        provider: nativeConfig.provider,
        userId: fixture.ownerId,
        workspaceId: fixture.workspaceId,
      })),
    )
    .returning();
  const repository = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
  const open = (first = asker.id, second = answerer.id) =>
    repository.openAgentPair({
      agents: [
        { agentId: first, config: {}, name: first === asker.id ? 'Asker' : 'Answerer' },
        { agentId: second, config: {}, name: second === asker.id ? 'Asker' : 'Answerer' },
      ],
      title: 'Asker · Answerer',
    });
  const pair = await open();
  const memberOf = (agentId: string) => pair.agents.find((agent) => agent.agentId === agentId)!;

  /** The Asker's request to the Answerer, as `sendMessage` writes it. */
  const ask = (content: string, hops = 1) =>
    repository.send(pair.channel.id, {
      authorAgentMemberId: memberOf(asker.id).id,
      content: `@Answerer ${content}`,
      mentions: [memberOf(answerer.id).id],
      metadata: { exchange: { hops, origin } },
      requestKey: `ask:${content}`,
      routing: 'fallback',
    });

  /** Runs the one job queued for a message and publishes `content` as its reply. */
  const answer = async (
    messageId: string,
    content: string,
    whileRunning?: (operationId: string) => Promise<void>,
  ) => {
    const [job] = await jobsOf(db, messageId);
    const claim = (await execution.claim(pair.channel.id, job.id, lease))!;
    await whileRunning?.(claim.job.operationId!);
    await execution.accepted(pair.channel.id, job.id);
    await execution.saveDraft(pair.channel.id, job.id, content);
    const replyId = await execution.publish(pair.channel.id, job.id);
    await execution.releaseWriter(pair.channel.id, job.id);
    return { claim, job, replyId };
  };

  return { answer, answerer, ask, asker, memberOf, open, pair, repository };
};

describe('A conversation between Agents', () => {
  // An Agent's request is not the person reading: their unseen answers stay unread.
  it('leaves the person’s unread count alone when an Agent asks', async () => {
    const { answer, ask, pair, repository } = await setup();
    const first = await ask('First?');
    await answer(first.id, 'First answer');
    await ask('Second?');

    const listed = (await repository.list()).find((item) => item.id === pair.channel.id);
    expect(listed?.unreadCount).toBe(3);
  });

  it('is one per pair, whichever Agent opens it', async () => {
    const { answerer, asker, open, pair } = await setup();

    expect(pair.channel).toMatchObject({
      agentId: null,
      agentPairKey: [asker.id, answerer.id].sort().join(':'),
      userId: fixture.ownerId,
      visibility: 'private',
    });
    expect(pair.member).toMatchObject({ role: 'owner', userId: fixture.ownerId });
    expect(pair.agents.map((agent) => agent.agentId).sort()).toEqual(
      [asker.id, answerer.id].sort(),
    );

    const reopened = await open(answerer.id, asker.id);
    expect(reopened.channel.id).toBe(pair.channel.id);
    expect(reopened.agents).toHaveLength(2);
  });

  it("writes an Agent's request as that Agent while its person stays the requester", async () => {
    const { answerer, ask, asker, memberOf, pair, repository } = await setup();
    const request = await ask('is T-1 fixed?');

    expect(request).toMatchObject({
      agentId: asker.id,
      routingStatus: 'directed',
      userId: null,
    });
    const [job] = await jobsOf(db, request.id);
    expect(job).toMatchObject({
      memberId: memberOf(answerer.id).id,
      requesterMemberId: pair.member.id,
    });

    const view = await repository.detail(pair.channel.id);
    const shown = view.messages.find((message) => message.id === request.id);
    expect(shown?.author).toMatchObject({ id: asker.id, name: 'Asker', type: 'agent' });
    expect(shown?.via).toBeNull();

    const claim = (await execution.claim(pair.channel.id, job.id, lease))!;
    const [context] = await readManifestMessages(db, pair.channel.id, claim.job.manifest!, {
      messageId: request.id,
    });
    expect(context.author).toEqual({ id: asker.id, name: 'Asker', type: 'agent' });
  });

  it('retries an Agent request idempotently', async () => {
    const { ask } = await setup();
    const first = await ask('is T-1 fixed?');
    const again = await ask('is T-1 fixed?');
    expect(again.id).toBe(first.id);
  });

  it('refuses an Agent request anywhere else', async () => {
    const team = await fixture.createTeamChannel();
    const reviewer = await fixture.addAgent(team.channel.id, 'Reviewer');
    const other = await fixture.addAgent(team.channel.id, 'Other');

    await expect(
      team.asOwner.send(team.channel.id, {
        authorAgentMemberId: reviewer.id,
        content: '@Other hi',
        mentions: [other.id],
        requestKey: 'agent-in-group',
        routing: 'fallback',
      }),
    ).rejects.toBeInstanceOf(ChannelError);
  });

  it('wakes the asking Agent with the answer, and ends the exchange at its reply', async () => {
    const { answer, ask, asker, memberOf, pair } = await setup();
    const request = await ask('is T-1 fixed?');
    const { replyId } = await answer(request.id, 'Not yet, no PR');

    expect(await execution.deliverAnswerToAsker(pair.channel.id, replyId)).toBe(true);
    // Idempotent: the answer queues one job.
    expect(await execution.deliverAnswerToAsker(pair.channel.id, replyId)).toBe(false);
    const [woken] = await jobsOf(db, replyId);
    expect(woken).toMatchObject({
      memberId: memberOf(asker.id).id,
      requesterMemberId: pair.member.id,
    });

    const { replyId: conclusionId } = await answer(
      replyId,
      'Tell Arvin: not fixed',
      async (operationId) => {
        await db
          .update(agentOperations)
          .set({ status: 'running' })
          .where(eq(agentOperations.id, operationId));
        const run = await new ChannelHistoryRepository(
          db,
          fixture.ownerId,
          fixture.workspaceId,
        ).currentRun(operationId);
        expect(run.exchange).toEqual({ hops: 1, origin });
        expect(run.requestVia).toBeUndefined();
      },
    );

    // The asking Agent's own reply answers an answer: it wakes no one.
    expect(await execution.deliverAnswerToAsker(pair.channel.id, conclusionId)).toBe(false);
    expect(await jobsOf(db, conclusionId)).toEqual([]);
  });

  it("does not wake anyone for an answer to the person's own request", async () => {
    const { answer, answerer, memberOf, pair, repository } = await setup();
    const request = await repository.send(pair.channel.id, {
      content: '@Answerer status?',
      mentions: [memberOf(answerer.id).id],
      requestKey: 'person',
      routing: 'fallback',
    });
    const { replyId } = await answer(request.id, 'All good');

    expect(await execution.deliverAnswerToAsker(pair.channel.id, replyId)).toBe(false);
    const [reply] = await db.select().from(channelMessages).where(eq(channelMessages.id, replyId));
    expect(reply.routingStatus).toBe('reply');
  });
});
