import type { ChannelMemberConfig, ChannelMemberRole, ChannelRuntime } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';

import {
  agentOperations,
  agents,
  channelJobs,
  channelMembers,
  channels,
  devices,
  users,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ChannelRepository } from '..';

type AgentFixtureConfig = ChannelMemberConfig & {
  model: string;
  provider: string;
  runtime: ChannelRuntime;
};

export const nativeConfig: AgentFixtureConfig = {
  model: 'gpt-5',
  provider: 'openai',
  runtime: 'native',
};

/** `device-1` is public in the fixture workspace; any other device id needs a grant. */
export const deviceConfig = (
  workingDirectory = '/repo',
  deviceId = 'device-1',
  deviceOwnerId?: string,
): AgentFixtureConfig => ({
  deviceId,
  deviceOwnerId,
  model: 'gpt-5',
  provider: 'openai',
  runtime: 'codex',
  workingDirectory,
});

export const lease = { serverDefaultAgentConfig: {}, leaseMs: 60_000, leaseOwner: 'worker-1' };

/**
 * Users and a workspace for one test file. Each file passes its own prefix so files can
 * share a server database.
 */
export const createChannelFixture = (db: LobeChatDatabase, prefix: string) => {
  const ownerId = `${prefix}-owner`;
  const memberId = `${prefix}-member`;
  const workspaceId = `${prefix}-workspace`;
  const userIds = [ownerId, memberId];

  const setup = async () => {
    await db.insert(users).values([
      { fullName: 'Olivia Owner', id: ownerId },
      { id: memberId, username: 'mia' },
    ]);
    await db
      .insert(workspaces)
      .values({ id: workspaceId, name: 'Workspace', primaryOwnerId: ownerId, slug: workspaceId });
    await db.insert(devices).values({
      deviceId: 'device-1',
      identitySource: 'fallback',
      userId: ownerId,
      visibility: 'public',
      workspaceId,
    });
  };

  const cleanup = async () => {
    // Raw user deletion preserves Channel history; remove fixture-owned personal Channels too.
    await db.delete(channels).where(inArray(channels.userId, userIds));
    // Operations outlive their channel by design; drop the ones this fixture ran.
    await db.delete(agentOperations).where(inArray(agentOperations.userId, userIds));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(inArray(users.id, userIds));
  };

  const addAgent = async (channelId: string, name: string, config = nativeConfig) => {
    const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
    const [source] = await db
      .insert(agents)
      .values({
        userId: ownerId,
        workspaceId: channel.workspaceId,
        name,
        model: config.model,
        provider: config.provider,
        agencyConfig:
          config.runtime === 'native'
            ? undefined
            : { heterogeneousProvider: { type: config.runtime } },
      })
      .returning();
    return new ChannelRepository(db, ownerId, channel.workspaceId).addAgent(channelId, {
      agentId: source.id,
      config,
      name,
    });
  };

  const addPerson = async (channelId: string, userId: string, role: ChannelMemberRole) => {
    const [person] = await db
      .insert(channelMembers)
      .values({ actorType: 'user', channelId, lastReadSequence: 0, role, userId })
      .returning();
    return person;
  };

  /** A workspace channel owned by `ownerId`, with `memberId` as a plain member. */
  const createTeamChannel = async (title = 'Team') => {
    const asOwner = new ChannelRepository(db, ownerId, workspaceId);
    const { channel, member: owner } = await asOwner.create({ title });
    const member = await addPerson(channel.id, memberId, 'member');

    return {
      asMember: new ChannelRepository(db, memberId, workspaceId),
      asOwner,
      channel,
      member,
      owner,
    };
  };

  return { addAgent, addPerson, cleanup, createTeamChannel, memberId, ownerId, setup, workspaceId };
};

export const jobsOf = (db: LobeChatDatabase, messageId: string) =>
  db.select().from(channelJobs).where(eq(channelJobs.messageId, messageId));

export const jobById = async (db: LobeChatDatabase, jobId: string) => {
  const [job] = await db.select().from(channelJobs).where(eq(channelJobs.id, jobId));
  return job;
};

export const operationById = async (db: LobeChatDatabase, operationId: string | null) => {
  const [operation] = await db
    .select()
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId!));
  return operation;
};
