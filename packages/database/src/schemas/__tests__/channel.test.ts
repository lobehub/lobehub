// @vitest-environment node
import type { ChannelInputManifest, ChannelMemberConfig } from '@lobechat/types';
import { eq, inArray, or } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentOperations,
  agents,
  channelJobs,
  channelMemberGrants,
  channelMembers,
  channelMessageFiles,
  channelMessages,
  channels,
  channelThreads,
  files,
  projects,
  users,
  workspaces,
} from '..';

const serverDB = await getTestDB();
const ownerId = 'channel-schema-owner';
const otherId = 'channel-schema-other';
const workspaceId = 'channel-schema-workspace';

const agentConfig: ChannelMemberConfig = {
  deviceId: 'device-1',
  deviceOwnerId: ownerId,
  workingDirectory: '/repo',
};

const createChannel = async (title = 'Channel') => {
  const [channel] = await serverDB
    .insert(channels)
    .values({ userId: ownerId, title, workspaceId })
    .returning();
  const [owner] = await serverDB
    .insert(channelMembers)
    .values({ actorType: 'user', channelId: channel.id, role: 'owner', userId: ownerId })
    .returning();
  const [source] = await serverDB
    .insert(agents)
    .values({ userId: ownerId, workspaceId })
    .returning();
  const [agent] = await serverDB
    .insert(channelMembers)
    .values({
      actorType: 'agent',
      agentId: source.id,
      channelId: channel.id,
      config: agentConfig,
      name: 'Codex',
    })
    .returning();

  return { agent, channel, owner };
};

const createMessage = async (channelId: string, authorMemberId: string, sequence: number) => {
  const [sender] = await serverDB
    .select()
    .from(channelMembers)
    .where(eq(channelMembers.id, authorMemberId));
  const [message] = await serverDB
    .insert(channelMessages)
    .values({
      agentId: sender.agentId,
      userId: sender.userId,
      channelId,
      content: `message ${sequence}`,
      requestKey: `request-${sequence}`,
      routingStatus: sender.actorType === 'agent' ? 'reply' : 'directed',
      sequence,
    })
    .returning();
  return message;
};

const manifest = (requesterMemberId: string, memberId: string): ChannelInputManifest => ({
  afterSequence: 0,
  cutoffSequence: 1,
  requestMessageId: 'unused',
  requesterMemberId,
  self: { agentId: 'fixture-agent', memberId, name: 'Codex' },
  threadId: null,
  threadRootSequence: null,
});

/** Creates a job claimed by `agent`, holding the writer on the given device directory. */
const createClaimedJob = async (
  fixture: Awaited<ReturnType<typeof createChannel>>,
  sequence: number,
  directory: { deviceId: string; workingDirectory: string } | null = {
    deviceId: 'device-1',
    workingDirectory: '/repo',
  },
) => {
  const { agent, channel, owner } = fixture;
  const message = await createMessage(channel.id, owner.id, sequence);
  const [operation] = await serverDB
    .insert(agentOperations)
    .values({
      id: `op_${channel.id}_${sequence}`,
      userId: ownerId,
      status: 'idle',
      workspaceId,
    })
    .returning();

  return serverDB
    .insert(channelJobs)
    .values({
      channelId: channel.id,
      manifest: manifest(owner.id, agent.id),
      memberId: agent.id,
      messageId: message.id,
      operationId: operation.id,
      requesterMemberId: owner.id,
      status: 'running',
      writerHeld: true,
      ...directory,
    })
    .returning();
};

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: ownerId }, { id: otherId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Workspace', primaryOwnerId: ownerId, slug: workspaceId });
});

afterEach(async () => {
  // Fixture writers never start a process. Release them first: the deletion guard refuses to
  // cascade over a held writer, and a leftover row would block every later file's cleanup.
  await serverDB
    .update(channelJobs)
    .set({ writerHeld: false })
    .where(
      inArray(
        channelJobs.channelId,
        serverDB
          .select({ id: channels.id })
          .from(channels)
          .where(
            or(eq(channels.workspaceId, workspaceId), inArray(channels.userId, [ownerId, otherId])),
          ),
      ),
    );
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users).where(inArray(users.id, [ownerId, otherId]));
});

describe('channel schema', () => {
  it('generates UUIDs for internal messages and jobs', async () => {
    const fixture = await createChannel();
    const [job] = await createClaimedJob(fixture, 1);
    expect(job.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
    expect(job.messageId).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i,
    );
  });

  it('defaults metadata to an empty object on every extensible channel table', async () => {
    const { agent, channel, owner } = await createChannel();
    const message = await createMessage(channel.id, owner.id, 1);
    const [thread] = await serverDB
      .insert(channelThreads)
      .values({ channelId: channel.id, rootMessageId: message.id, rootSequence: 1 })
      .returning();
    const [grant] = await serverDB
      .insert(channelMemberGrants)
      .values({
        channelId: channel.id,
        deviceId: 'device-1',
        deviceOwnerId: otherId,
        memberId: agent.id,
        requestedByMemberId: owner.id,
        workingDirectory: '/repo',
      })
      .returning();

    for (const row of [channel, owner, agent, grant, thread, message]) {
      expect(row.metadata).toEqual({});
    }
  });

  describe('members', () => {
    it('enforces Agent references and preserves authored history after Agent deletion', async () => {
      const { agent, channel, owner } = await createChannel();
      const [source] = await serverDB.insert(agents).values({ userId: ownerId }).returning();

      await expect(
        serverDB
          .update(channelMembers)
          .set({ agentId: 'agt_missing' })
          .where(eq(channelMembers.id, agent.id)),
      ).rejects.toThrow();
      await expect(
        serverDB
          .update(channelMembers)
          .set({ agentId: source.id })
          .where(eq(channelMembers.id, owner.id)),
      ).rejects.toThrow();
      await serverDB
        .update(channelMembers)
        .set({ agentId: source.id })
        .where(eq(channelMembers.id, agent.id));
      const message = await createMessage(channel.id, agent.id, 1);

      await serverDB.delete(agents).where(eq(agents.id, source.id));

      const [keptMember] = await serverDB
        .select()
        .from(channelMembers)
        .where(eq(channelMembers.id, agent.id));
      const [keptMessage] = await serverDB
        .select()
        .from(channelMessages)
        .where(eq(channelMessages.id, message.id));
      expect(keptMember).toMatchObject({ agentId: null, config: agentConfig, name: 'Codex' });
      expect(keptMessage).toMatchObject({
        agentId: null,
        userId: null,
        content: message.content,
        routingStatus: 'reply',
      });
    });

    it('keeps people and Agents in one member table with their own fields', async () => {
      const { agent, owner } = await createChannel();

      expect(owner).toMatchObject({ actorType: 'user', config: null, role: 'owner' });
      expect(agent).toMatchObject({ actorType: 'agent', config: agentConfig, role: null });
      expect(owner.metadata).toEqual({});
      expect(agent.metadata).toEqual({});
    });

    it('rejects members whose fields do not match their actor type', async () => {
      const { channel } = await createChannel();

      await expect(
        serverDB
          .insert(channelMembers)
          .values({ actorType: 'user', channelId: channel.id, userId: otherId }),
      ).rejects.toThrow();
      await expect(
        serverDB
          .insert(channelMembers)
          .values({ actorType: 'agent', channelId: channel.id, name: 'No config' }),
      ).rejects.toThrow();
      await expect(
        serverDB.insert(channelMembers).values({
          actorType: 'agent',
          channelId: channel.id,
          config: agentConfig,
          name: 'Agent with a person',
          userId: otherId,
        }),
      ).rejects.toThrow();
    });

    it('rejects any field another actor type owns, and unknown actor types', async () => {
      const { channel } = await createChannel();
      const [source] = await serverDB.insert(agents).values({ userId: ownerId }).returning();
      const expectCheckViolation = async (values: typeof channelMembers.$inferInsert) => {
        const error = await serverDB
          .insert(channelMembers)
          .values(values)
          .then(
            () => undefined,
            (caught: { cause?: { code?: string }; code?: string }) => caught,
          );
        expect(error?.cause?.code ?? error?.code).toBe('23514');
      };
      const person = { actorType: 'user', channelId: channel.id, role: 'member' } as const;
      const agent = {
        actorType: 'agent',
        agentId: source.id,
        channelId: channel.id,
        config: agentConfig,
        name: 'Agent',
      } as const;

      await expectCheckViolation({ ...person, agentId: source.id, userId: otherId });
      await expectCheckViolation({ ...person, config: agentConfig, userId: otherId });
      await expectCheckViolation({ ...agent, role: 'member' });
      await expectCheckViolation({ ...agent, name: null });
      await expectCheckViolation({
        ...agent,
        actorType: 'app' as typeof agent.actorType,
      });
    });

    it('lets a person join a channel only once', async () => {
      const { channel } = await createChannel();

      await expect(
        serverDB
          .insert(channelMembers)
          .values({ actorType: 'user', channelId: channel.id, role: 'member', userId: ownerId }),
      ).rejects.toThrow();
    });

    it('keeps the authored history when a member deletes their account', async () => {
      const { channel } = await createChannel();
      const [other] = await serverDB
        .insert(channelMembers)
        .values({ actorType: 'user', channelId: channel.id, role: 'member', userId: otherId })
        .returning();
      const message = await createMessage(channel.id, other.id, 1);

      await serverDB.delete(users).where(eq(users.id, otherId));

      const [member] = await serverDB
        .select()
        .from(channelMembers)
        .where(eq(channelMembers.id, other.id));
      const [kept] = await serverDB
        .select()
        .from(channelMessages)
        .where(eq(channelMessages.id, message.id));
      expect(member.userId).toBeNull();
      expect(kept).toMatchObject({ agentId: null, userId: null, content: message.content });
    });
  });

  describe('messages', () => {
    it('rejects a retried request key and invalid sender references', async () => {
      const first = await createChannel('First');
      const message = await createMessage(first.channel.id, first.owner.id, 1);

      await expect(createMessage(first.channel.id, first.owner.id, 1)).rejects.toThrow();
      for (const sender of [
        { userId: 'missing-user' },
        { userId: null, agentId: 'missing-agent', routingStatus: 'reply' as const },
        { userId: ownerId, agentId: first.agent.agentId },
        { userId: null, agentId: first.agent.agentId },
        { userId: ownerId, routingStatus: 'reply' as const },
      ]) {
        await expect(
          serverDB.insert(channelMessages).values({
            ...message,
            ...sender,
            id: undefined,
            sequence: 2,
            requestKey: 'next',
          }),
        ).rejects.toThrow();
      }
    });

    it('keeps Channel attachments unique and drops them with the file', async () => {
      const first = await createChannel('First');
      const message = await createMessage(first.channel.id, first.owner.id, 1);
      const [file] = await serverDB
        .insert(files)
        .values({ fileType: 'text/plain', name: 'a.txt', size: 1, url: 'a.txt', userId: ownerId })
        .returning();
      const attach = () =>
        serverDB
          .insert(channelMessageFiles)
          .values({ fileId: file.id, messageId: message.id, sortOrder: 0 });

      await attach();
      await expect(attach()).rejects.toThrow();

      await serverDB.delete(files).where(eq(files.id, file.id));

      const remaining = await serverDB
        .select()
        .from(channelMessageFiles)
        .where(eq(channelMessageFiles.messageId, message.id));
      expect(remaining).toHaveLength(0);
      const [kept] = await serverDB
        .select()
        .from(channelMessages)
        .where(eq(channelMessages.id, message.id));
      expect(kept).toBeDefined();
    });
  });

  describe('writer locks', () => {
    it('allows one writer per member until it is released or isolated', async () => {
      const fixture = await createChannel();
      const [job] = await createClaimedJob(fixture, 1, null);

      await expect(createClaimedJob(fixture, 2, null)).rejects.toThrow();

      await serverDB
        .update(channelJobs)
        .set({ isolatedAt: new Date() })
        .where(eq(channelJobs.id, job.id));
      await expect(createClaimedJob(fixture, 3, null)).resolves.toHaveLength(1);
    });

    it('serializes writers on one device directory across channels', async () => {
      const first = await createChannel('First');
      const second = await createChannel('Second');
      const [job] = await createClaimedJob(first, 1);

      await expect(createClaimedJob(second, 1)).rejects.toThrow();
      await expect(
        createClaimedJob(second, 2, { deviceId: 'device-1', workingDirectory: '/other' }),
      ).resolves.toHaveLength(1);

      await serverDB
        .update(channelJobs)
        .set({ writerHeld: false })
        .where(eq(channelJobs.id, job.id));
      const third = await createChannel('Third');
      await expect(createClaimedJob(third, 1)).resolves.toHaveLength(1);
    });

    it('keeps the directory locked while an isolated writer is still unconfirmed', async () => {
      const first = await createChannel('First');
      const second = await createChannel('Second');
      const [job] = await createClaimedJob(first, 1);

      await serverDB
        .update(channelJobs)
        .set({ isolatedAt: new Date() })
        .where(eq(channelJobs.id, job.id));
      await expect(createClaimedJob(second, 1)).rejects.toThrow();

      await serverDB
        .update(channelJobs)
        .set({ writerHeld: false })
        .where(eq(channelJobs.id, job.id));
      await expect(createClaimedJob(second, 2)).resolves.toHaveLength(1);
    });
  });

  describe('grants', () => {
    it('binds one grant to each member', async () => {
      const { agent, channel, owner } = await createChannel();
      const grant = {
        channelId: channel.id,
        deviceId: 'device-1',
        deviceOwnerId: otherId,
        memberId: agent.id,
        requestedByMemberId: owner.id,
        workingDirectory: '/repo',
      };

      const [created] = await serverDB.insert(channelMemberGrants).values(grant).returning();
      expect(created.id).toMatch(
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i,
      );
      expect(created.status).toBe('pending');
      await expect(serverDB.insert(channelMemberGrants).values(grant)).rejects.toThrow();
      await expect(
        serverDB.insert(channelMemberGrants).values({ ...grant, workingDirectory: '/other' }),
      ).rejects.toThrow();
    });
  });

  describe('channels', () => {
    it('validates project associations and preserves history when the project is deleted', async () => {
      const { channel, owner } = await createChannel();
      expect(channel.projectId).toBeNull();
      const message = await createMessage(channel.id, owner.id, 1);
      await expect(
        serverDB
          .update(channels)
          .set({ projectId: 'prj_missing' })
          .where(eq(channels.id, channel.id)),
      ).rejects.toThrow();

      const [project] = await serverDB
        .insert(projects)
        .values({ name: 'Channel project', userId: ownerId, workspaceId })
        .returning();
      const [linked] = await serverDB
        .update(channels)
        .set({ projectId: project.id })
        .where(eq(channels.id, channel.id))
        .returning();
      expect(linked.projectId).toBe(project.id);

      await serverDB.delete(projects).where(eq(projects.id, project.id));

      const [kept] = await serverDB.select().from(channels).where(eq(channels.id, channel.id));
      expect(kept).toMatchObject({ id: channel.id, projectId: null, userId: ownerId, workspaceId });
      expect(
        await serverDB.select().from(channelMessages).where(eq(channelMessages.id, message.id)),
      ).toHaveLength(1);
    });

    it('deletes a channel with all of its rows but keeps its operations', async () => {
      const fixture = await createChannel();
      const [job] = await createClaimedJob(fixture, 1);

      // A held writer blocks the cascade until its process is confirmed stopped.
      await expect(
        serverDB.delete(channels).where(eq(channels.id, fixture.channel.id)),
      ).rejects.toThrow();
      await serverDB
        .update(channelJobs)
        .set({ writerHeld: false })
        .where(eq(channelJobs.id, job.id));
      await serverDB.delete(channels).where(eq(channels.id, fixture.channel.id));

      const members = await serverDB
        .select()
        .from(channelMembers)
        .where(eq(channelMembers.channelId, fixture.channel.id));
      const jobs = await serverDB
        .select()
        .from(channelJobs)
        .where(eq(channelJobs.channelId, fixture.channel.id));
      expect(members).toHaveLength(0);
      expect(jobs).toHaveLength(0);
      // Ordinary execution history outlives its Channel source.
      const [operation] = await serverDB
        .select()
        .from(agentOperations)
        .where(eq(agentOperations.id, job.operationId!));
      expect(operation).toMatchObject({ id: job.operationId, userId: ownerId });
    });
  });
});
