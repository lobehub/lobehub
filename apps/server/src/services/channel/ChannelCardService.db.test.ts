// @vitest-environment node
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { ChannelExecutionRepository } from '@/database/repositories/channel';
import {
  createChannelFixture,
  jobsOf,
  lease,
} from '@/database/repositories/channel/__tests__/testUtils';
import {
  agentOperations,
  channelJobs,
  channelMessages,
  messagePlugins,
  messages,
  topics,
  workspaceMembers,
} from '@/database/schemas';

import { ChannelCardService } from './ChannelCardService';
import { ChannelPostService } from './ChannelPostService';
import { runSurfaces } from './runSurfaces';

/**
 * An external CLI runtime draws a card with `lh card render`; the reply's publish posts it like a
 * card a builtin Agent drew. Real: the Channel repositories and models on PGlite. Faked: the
 * gateway nudge and the feature gate.
 */

vi.mock('./queue', () => ({ registerLocalChannelAdvance: vi.fn(), wakeChannel: vi.fn() }));
vi.mock('./notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('./featureGate', () => ({ assertChannelEnabled: vi.fn() }));

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-cli-card');
const execution = new ChannelExecutionRepository(db);
beforeEach(async () => {
  await fixture.setup();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: fixture.workspaceId, userId: fixture.ownerId });
});
afterEach(fixture.cleanup);

const card = (title: string) => [
  {
    updateComponents: {
      components: [
        { child: 'body', component: 'Card', id: 'root', title },
        { component: 'Text', id: 'body', text: '12 done' },
      ],
      surfaceId: 'weekly',
    },
    version: '1.0',
  },
];

/** The owner asks the Reporter in "Team"; its run is live, on a step, with its own Topic. */
const setup = async () => {
  const team = await fixture.createTeamChannel();
  const reporter = await fixture.addAgent(team.channel.id, 'Reporter');
  const request = await team.asOwner.send(team.channel.id, {
    content: '@Reporter weekly report',
    mentions: [reporter.id],
    requestKey: 'request',
    routing: 'decision',
  });
  const [job] = await jobsOf(db, request.id);
  const claim = (await execution.claim(team.channel.id, job.id, lease))!;
  const operationId = claim.job.operationId!;
  const [topic] = await db
    .insert(topics)
    .values({ userId: fixture.ownerId, workspaceId: fixture.workspaceId })
    .returning();
  await db.update(channelJobs).set({ topicId: topic.id }).where(eq(channelJobs.id, job.id));
  await db
    .update(agentOperations)
    .set({ status: 'running', topicId: topic.id })
    .where(eq(agentOperations.id, operationId));
  const model = new MessageModel(db, fixture.ownerId, fixture.workspaceId);
  // The step the device runtime persisted, stamped with the run like every hetero step.
  const step = await model.create({
    content: '',
    metadata: { operationId },
    role: 'assistant',
    topicId: topic.id,
  });
  const service = new ChannelCardService(db, fixture.ownerId, operationId, fixture.workspaceId);
  return { ...team, jobId: job.id, model, operationId, reporter, service, step, topicId: topic.id };
};

const cardRows = (topicId: string) =>
  db
    .select({ parentId: messages.parentId, state: messagePlugins.state })
    .from(messagePlugins)
    .innerJoin(messages, eq(messages.id, messagePlugins.id))
    .where(eq(messages.topicId, topicId));

describe('ChannelCardService.render', () => {
  it('returns the validator’s errors for an invalid card and stores nothing', async () => {
    const { service, topicId } = await setup();
    const result = await service.render([
      {
        updateComponents: { components: [{ component: 'Map', id: 'root' }], surfaceId: 's' },
        version: '1.0',
      },
    ]);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.errors.join()).toMatch(/Unknown component "Map"/);
    expect(result.message).toContain('lh card render');
    expect(await service.render('not an array')).toMatchObject({ ok: false });
    expect(await cardRows(topicId)).toEqual([]);
  });

  it('records a valid card as a renderUI result under the run’s step, which the run’s cards include', async () => {
    const { model, operationId, service, step, topicId } = await setup();
    expect(await service.render(card('Weekly report'))).toMatchObject({
      ok: true,
      replaced: false,
      surfaceId: 'weekly',
    });

    expect(await cardRows(topicId)).toEqual([expect.objectContaining({ parentId: step.id })]);
    expect(await runSurfaces(model, operationId, topicId)).toEqual([
      expect.objectContaining({ surfaceId: 'weekly', title: 'Weekly report' }),
    ]);
  });

  it('replaces the card when the same surface is rendered again, even from a later step', async () => {
    const { model, operationId, service, topicId } = await setup();
    await service.render(card('Draft'));
    await model.create({ content: '', metadata: { operationId }, role: 'assistant', topicId });
    expect(await service.render(card('Final'))).toMatchObject({ ok: true, replaced: true });

    expect(await cardRows(topicId)).toHaveLength(1);
    expect(await runSurfaces(model, operationId, topicId)).toEqual([
      expect.objectContaining({ surfaceId: 'weekly', title: 'Final' }),
    ]);
  });

  it('is scoped to its run: another run of the Topic never sees its card', async () => {
    const { model, operationId, service, topicId } = await setup();
    await service.render(card('Weekly report'));
    expect(await runSurfaces(model, `${operationId}-other`, topicId)).toEqual([]);

    // A run that is not a Channel reply has nowhere to post a card.
    const stranger = new ChannelCardService(db, fixture.ownerId, 'op-without-job');
    await expect(stranger.render(card('Lost'))).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses a run that has not persisted a step yet', async () => {
    const { service, step } = await setup();
    await db.delete(messages).where(eq(messages.id, step.id));
    await expect(service.render(card('Early'))).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('serves the builtin card guide, framed for the command line', async () => {
    const { service } = await setup();
    const { guide } = await service.guide();
    expect(guide).toContain('lh card render --file card.json');
    expect(guide).toContain('<a2ui_guide>');
  });
});

describe('publishing a reply with a CLI-drawn card', () => {
  it('posts a card-only reply like a builtin Agent’s', async () => {
    const { channel, jobId, model, operationId, service, topicId } = await setup();
    await service.render(card('Weekly report'));

    // What the coordinator does when the run ends with no words after its card.
    const surfaces = await runSurfaces(model, operationId, topicId);
    await execution.accepted(channel.id, jobId);
    await execution.saveDraft(channel.id, jobId, '');
    const replyId = await execution.publish(channel.id, jobId, surfaces);

    const [reply] = await db.select().from(channelMessages).where(eq(channelMessages.id, replyId));
    expect(reply.content).toContain('Weekly report');
    expect(reply.metadata).toMatchObject({
      surfaces: [expect.objectContaining({ surfaceId: 'weekly' })],
      surfacesBodyLength: 0,
    });
  });

  it('carries the card when the Agent posts as itself in another Channel', async () => {
    const { asOwner, operationId, reporter, service } = await setup();
    await service.render(card('Weekly report'));
    const { channel: other } = await asOwner.create({ title: 'Announcements' });
    await asOwner.addAgent(other.id, { agentId: reporter.agentId!, config: {}, name: 'Reporter' });

    const post = new ChannelPostService(db, fixture.ownerId, operationId, fixture.workspaceId);
    const posted = await post.postMessage({ channelId: other.id }, 'call-elsewhere');
    expect(posted.cards).toBe(1);
    const [stored] = await db
      .select()
      .from(channelMessages)
      .where(eq(channelMessages.id, posted.messageId));
    expect(stored.metadata).toMatchObject({
      surfaces: [expect.objectContaining({ surfaceId: 'weekly' })],
    });
  });
});
