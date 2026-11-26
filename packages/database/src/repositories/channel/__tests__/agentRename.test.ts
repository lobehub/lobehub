// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { AgentModel } from '../../../models/agent';
import { agents, channelMembers, channels } from '../../../schemas';
import { ChannelRepository } from '..';
import { writeAgent } from '../agentRename';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-agent-rename');
beforeEach(fixture.setup);
afterEach(fixture.cleanup);

const createDirect = async (title: string) => {
  const [agent] = await db.insert(agents).values({ title, userId: fixture.ownerId }).returning();
  const { channel } = await new ChannelRepository(db, fixture.ownerId).create({
    agentConfig: {},
    agentId: agent.id,
    title,
  });
  return { agent, channel };
};

const titleOf = async (channelId: string) => {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  return channel.title;
};

const memberNameOf = async (channelId: string) => {
  const [member] = await db
    .select()
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.actorType, 'agent')));
  return member.name;
};

describe('renaming an Agent', () => {
  it.each(['updateConfig', 'update'] as const)(
    'renames its direct conversation and member label through %s',
    async (method) => {
      const { agent, channel } = await createDirect('Writer (Copy)');
      expect(await memberNameOf(channel.id)).toBe('Writer (Copy)');

      await new AgentModel(db, fixture.ownerId)[method](agent.id, { title: 'Writer' });

      expect(await titleOf(channel.id)).toBe('Writer');
      expect(await memberNameOf(channel.id)).toBe('Writer');
    },
  );

  it('follows the name that wins over the title', async () => {
    const { agent, channel } = await createDirect('Writer');

    await new AgentModel(db, fixture.ownerId).updateConfig(agent.id, { name: 'Ada' });

    expect(await titleOf(channel.id)).toBe('Ada');
    expect(await memberNameOf(channel.id)).toBe('Ada');
  });

  it('keeps a title or label a member set in the Channel', async () => {
    const { agent, channel } = await createDirect('Writer');
    await db.update(channels).set({ title: 'My writer' }).where(eq(channels.id, channel.id));
    await db
      .update(channelMembers)
      .set({ name: 'Scribe' })
      .where(eq(channelMembers.channelId, channel.id));

    await new AgentModel(db, fixture.ownerId).updateConfig(agent.id, { title: 'Editor' });

    expect(await titleOf(channel.id)).toBe('My writer');
    expect(await memberNameOf(channel.id)).toBe('Scribe');
  });

  it.each(['updateConfig', 'update'] as const)(
    'ends on the name the Agent keeps when two renames through %s overlap',
    async (method) => {
      const { agent, channel } = await createDirect('Writer');
      const model = new AgentModel(db, fixture.ownerId);

      await Promise.all([
        model[method](agent.id, { title: 'Editor' }),
        model[method](agent.id, { title: 'Reviewer' }),
      ]);

      const [renamed] = await db.select().from(agents).where(eq(agents.id, agent.id));
      expect(await titleOf(channel.id)).toBe(renamed.title);
      expect(await memberNameOf(channel.id)).toBe(renamed.title);
    },
  );

  it('reruns a rename that PostgreSQL picked as a deadlock victim', async () => {
    const { agent, channel } = await createDirect('Writer');
    const deadlock = Object.assign(new Error('deadlock detected'), {
      cause: { code: '40P01' },
    });
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(deadlock)
      .mockImplementation((fn) => db.transaction(fn));
    const flaky = Object.assign(Object.create(db), { transaction }) as typeof db;

    await writeAgent(flaky, eq(agents.id, agent.id), agent.id, { title: 'Editor' });

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(await titleOf(channel.id)).toBe('Editor');
    expect(await memberNameOf(channel.id)).toBe('Editor');
  });
});
