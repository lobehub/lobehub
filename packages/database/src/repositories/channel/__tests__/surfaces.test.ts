// @vitest-environment node
import type { ChannelMessageSurface } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agentOperations, channelMessages, workspaceMembers } from '../../../schemas';
import { ChannelExecutionRepository } from '..';
import { createChannelFixture, jobsOf, lease } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-surfaces');
const execution = new ChannelExecutionRepository(db);
beforeEach(async () => {
  await fixture.setup();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: fixture.workspaceId, userId: fixture.memberId });
});
afterEach(fixture.cleanup);

const surface: ChannelMessageSurface = {
  catalogId: 'https://lobehub.com/a2ui/catalog/v1',
  fallback: 'DC daily check · 5xx 0 · 4xx 667 +57%',
  operations: [
    {
      createSurface: { catalogId: 'https://lobehub.com/a2ui/catalog/v1', surfaceId: 'dc' },
      version: '1.0',
    },
    {
      updateComponents: {
        components: [{ child: 't', component: 'Card', id: 'root', title: 'DC daily check' }],
        surfaceId: 'dc',
      },
      version: '1.0',
    },
  ],
  surfaceId: 'dc',
  title: 'DC daily check',
  version: '1.0',
};

/** The member asks the Agent; its run draws `surfaces` and publishes `draft`. */
const cardReply = async (draft: string, surfaces: ChannelMessageSurface[]) => {
  const team = await fixture.createTeamChannel();
  const agent = await fixture.addAgent(team.channel.id, 'Patrol');
  const request = await team.asMember.send(team.channel.id, {
    content: 'How did the night go?',
    mentions: [agent.id],
    requestKey: 'surface-request',
    routing: 'decision',
  });
  const [job] = await jobsOf(db, request.id);
  const claim = (await execution.claim(team.channel.id, job.id, lease))!;
  const operationId = claim.job.operationId!;
  await db
    .update(agentOperations)
    .set({ status: 'running' })
    .where(eq(agentOperations.id, operationId));
  await execution.accepted(team.channel.id, job.id);
  await execution.saveDraft(team.channel.id, job.id, draft);
  const replyId = await execution.publish(team.channel.id, job.id, surfaces);
  const reply = (await team.asMember.detail(team.channel.id)).messages.find(
    (message) => message.id === replyId,
  )!;
  return { ...team, job, operationId, reply, replyId };
};

describe('Channel replies with cards', () => {
  // The content is what an Agent reads back and what previews show, so it carries the card text.
  it('publishes the cards with the reply, keeping their text after its words', async () => {
    const { reply } = await cardReply('Here is the overnight check.', [surface]);
    expect(reply.surfaces).toEqual([surface]);
    expect(reply.surfacesBodyLength).toBe('Here is the overnight check.'.length);
    expect(reply.content).toBe(
      'Here is the overnight check.\n\n[Card] DC daily check · 5xx 0 · 4xx 667 +57%',
    );
  });

  it('publishes a reply that is only a card', async () => {
    const { reply } = await cardReply('', [surface]);
    expect(reply.surfaces).toHaveLength(1);
    expect(reply.surfacesBodyLength).toBe(0);
    expect(reply.content).toBe('[Card] DC daily check · 5xx 0 · 4xx 667 +57%');
  });

  it('leaves a plain reply untouched', async () => {
    const { reply } = await cardReply('Quiet night.', []);
    expect(reply.content).toBe('Quiet night.');
    expect(reply.surfaces).toEqual([]);
    expect(reply.surfacesBodyLength).toBeUndefined();
  });

  it('drops the cards when the reply is deleted, so no button stays live on a tombstone', async () => {
    const state = await cardReply('Here is the plan.', [surface]);
    await state.asOwner.deleteMessage(state.channel.id, state.replyId);
    const [row] = await db
      .select({ metadata: channelMessages.metadata })
      .from(channelMessages)
      .where(eq(channelMessages.id, state.replyId));
    expect(row.metadata).not.toHaveProperty('surfaces');
    const reply = (await state.asMember.detail(state.channel.id)).messages.find(
      (message) => message.id === state.replyId,
    )!;
    expect(reply.deletedAt).toBeTruthy();
    expect(reply.surfaces).toEqual([]);
  });
});
