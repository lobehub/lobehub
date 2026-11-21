// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, channelJobs, workspaceMembers } from '../../../schemas';
import { ChannelExecutionRepository, ChannelHistoryRepository } from '..';
import { answerAsk } from '../ask';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-ask');
const execution = new ChannelExecutionRepository(db);
beforeEach(async () => {
  await fixture.setup();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: fixture.workspaceId, userId: fixture.memberId });
});
afterEach(fixture.cleanup);

const questions = [
  {
    options: [{ label: 'Diet' }, { description: 'Workouts and steps', label: 'Exercise' }],
    question: 'What should I watch first?',
  },
];

/** The member asks the Agent, whose run is now running. */
const running = async () => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Helper');
  const request = await team.asMember.send(team.channel.id, {
    content: 'Help me stay healthy',
    mentions: [agent.id],
    requestKey: 'ask-request',
    routing: 'decision',
  });
  const [job] = await jobsOf(db, request.id);
  const claim = (await execution.claim(team.channel.id, job.id, lease))!;
  const operationId = claim.job.operationId!;
  await db
    .update(agentOperations)
    .set({ status: 'running' })
    .where(eq(agentOperations.id, operationId));
  const history = new ChannelHistoryRepository(db, fixture.memberId, fixture.workspaceId);
  return { ...team, agent, history, job, operationId };
};

/** The run asks back and publishes `draft` with its questions. */
const askedReply = async (draft = 'Hi, I am your health helper.') => {
  const state = await running();
  await state.history.ask(state.operationId, { questions });
  await execution.accepted(state.channel.id, state.job.id);
  await execution.saveDraft(state.channel.id, state.job.id, draft);
  const replyId = await execution.publish(state.channel.id, state.job.id);
  return { ...state, replyId };
};

const answer = (state: Awaited<ReturnType<typeof askedReply>>, selected: string[], as = 'member') =>
  (as === 'member' ? state.asMember : state.asOwner).write(state.channel.id, (tx, access) =>
    answerAsk(tx, access, {
      answers: [{ selected }],
      messageId: state.replyId,
      requestKey: `answer:${state.replyId}`,
    }),
  );

describe('Channel ask messages', () => {
  it('publishes the questions with the reply as an ask, with a text fallback', async () => {
    const state = await askedReply();
    const reply = (await state.asMember.detail(state.channel.id)).messages.find(
      (message) => message.id === state.replyId,
    )!;

    expect(reply.kind).toBe('ask');
    expect(reply.content).toBe(
      'Hi, I am your health helper.\n\nWhat should I watch first?\nA. Diet\nB. Exercise — Workouts and steps',
    );
    expect(reply.ask).toMatchObject({
      bodyLength: 'Hi, I am your health helper.'.length,
      questions,
      requesterMemberId: state.member.id,
      status: 'pending',
    });
  });

  it('keeps one ask per run: the same questions again are a no-op, others are refused', async () => {
    const state = await running();
    await state.history.ask(state.operationId, { questions });
    await state.history.ask(state.operationId, { questions });
    await expect(
      state.history.ask(state.operationId, {
        questions: [{ ...questions[0], question: 'Other?' }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const [job] = await db.select().from(channelJobs).where(eq(channelJobs.id, state.job.id));
    expect(job.ask).toEqual({ questions });
  });

  it('posts only the questions when the run wrote nothing around them', async () => {
    const state = await askedReply('');
    const reply = (await state.asMember.detail(state.channel.id)).messages.find(
      (message) => message.id === state.replyId,
    )!;
    expect(reply.content.startsWith('What should I watch first?')).toBe(true);
    expect(reply.ask?.bodyLength).toBe(0);
  });

  it('posts the requester’s answer as their reply to the question and marks it answered', async () => {
    const state = await askedReply();
    const posted = await answer(state, ['Exercise']);

    expect(posted).toMatchObject({ content: 'B. Exercise', replyToId: state.replyId });
    // Quoting the Agent's question asks that Agent again.
    const [job] = await jobsOf(db, posted.id);
    expect(job.memberId).toBe(state.agent.id);

    const reply = (await state.asMember.detail(state.channel.id)).messages.find(
      (message) => message.id === state.replyId,
    )!;
    expect(reply.ask).toMatchObject({
      answer: {
        answers: [{ selected: ['Exercise'] }],
        memberId: state.member.id,
        messageId: posted.id,
      },
      status: 'answered',
    });

    // A retry returns the answer it already posted; a second, different answer is refused.
    expect((await answer(state, ['Exercise'])).id).toBe(posted.id);
    await expect(
      state.asMember.write(state.channel.id, (tx, access) =>
        answerAsk(tx, access, {
          answers: [{ selected: ['Diet'] }],
          messageId: state.replyId,
          requestKey: 'another',
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('lets only the requester answer, and only with the listed options', async () => {
    const state = await askedReply();
    await expect(answer(state, ['Exercise'], 'owner')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(answer(state, ['Sleep'])).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(answer(state, ['Diet', 'Exercise'])).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});
