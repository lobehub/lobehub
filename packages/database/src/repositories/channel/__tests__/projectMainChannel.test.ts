// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, channelMembers, projects, workspaceMembers } from '../../../schemas';
import { ChannelRepository } from '..';
import { findProjectMainChannelId } from '../projectMainChannel';
import { createChannelFixture } from './testUtils';

const db = await getTestDB();
const fixture = createChannelFixture(db, 'channel-project-main');
beforeEach(async () => {
  await fixture.setup();
  await db.insert(workspaceMembers).values([
    { workspaceId: fixture.workspaceId, userId: fixture.ownerId, role: 'owner' },
    { workspaceId: fixture.workspaceId, userId: fixture.memberId },
  ]);
});
afterEach(async () => {
  await db.delete(projects).where(eq(projects.workspaceId, fixture.workspaceId));
  await db.delete(agents).where(eq(agents.workspaceId, fixture.workspaceId));
  await fixture.cleanup();
});

/** A project led by its own main Agent, with the General Channel it starts with. */
const projectWithGeneral = async (visibility: 'private' | 'public' = 'public') => {
  const [agent] = await db
    .insert(agents)
    .values({ title: 'Apollo', userId: fixture.ownerId, workspaceId: fixture.workspaceId })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      coordinatorAgentId: agent.id,
      name: 'Apollo',
      userId: fixture.ownerId,
      visibility,
      workspaceId: fixture.workspaceId,
    })
    .returning();
  const owner = new ChannelRepository(db, fixture.ownerId, fixture.workspaceId);
  const { channel } = await owner.create({
    agents: [{ agentId: agent.id, name: 'Apollo' }],
    projectId: project.id,
    title: 'General',
  });
  return { agent, channel, owner, project };
};

const find = (userId: string, agentId: string) =>
  findProjectMainChannelId(db, userId, fixture.workspaceId, agentId);

describe("a project's main Agent", () => {
  it("is reached in the project's General Channel", async () => {
    const { agent, channel } = await projectWithGeneral();

    expect(await find(fixture.ownerId, agent.id)).toBe(channel.id);
  });

  it('is reached there by a teammate who may open the project without having joined', async () => {
    const { agent, channel } = await projectWithGeneral();

    expect(await find(fixture.memberId, agent.id)).toBe(channel.id);
  });

  it("is not reached through a private project's Channel the teammate cannot read", async () => {
    const { agent } = await projectWithGeneral('private');

    expect(await find(fixture.memberId, agent.id)).toBeUndefined();
  });

  it('prefers the oldest Channel over later project Channels', async () => {
    const { agent, channel, owner, project } = await projectWithGeneral();
    await owner.create({
      agents: [{ agentId: agent.id, name: 'Apollo' }],
      projectId: project.id,
      title: 'Later',
    });

    expect(await find(fixture.ownerId, agent.id)).toBe(channel.id);
  });

  it('skips a Channel the Agent no longer sits in', async () => {
    const { agent, channel } = await projectWithGeneral();
    await db
      .update(channelMembers)
      .set({ status: 'removed' })
      .where(and(eq(channelMembers.channelId, channel.id), eq(channelMembers.actorType, 'agent')));

    expect(await find(fixture.ownerId, agent.id)).toBeUndefined();
  });

  it('is nothing for an Agent that leads no project', async () => {
    const [agent] = await db
      .insert(agents)
      .values({ title: 'Solo', userId: fixture.ownerId, workspaceId: fixture.workspaceId })
      .returning();

    expect(await find(fixture.ownerId, agent.id)).toBeUndefined();
  });
});
