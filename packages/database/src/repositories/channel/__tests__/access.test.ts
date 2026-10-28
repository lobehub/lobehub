// @vitest-environment node
import { eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { UserModel } from '../../../models/user';
import { agents, channelMembers, channels, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { ChannelError, ChannelRepository } from '..';

const serverDB: LobeChatDatabase = await getTestDB();
// Two concurrent transactions need separate connections; PGlite runs them one after another.
const isServerDB = process.env.TEST_SERVER_DB === '1';

const ownerId = 'channel-model-owner';
const memberId = 'channel-model-member';
const outsiderId = 'channel-model-outsider';
const workspaceId = 'channel-model-workspace';

const addPerson = async (channelId: string, userId: string, role: 'admin' | 'member') =>
  serverDB.insert(channelMembers).values({ actorType: 'user', channelId, role, userId });

/** Resolves once some session in this database is waiting on a row lock. */
const waitForLockWaiter = async () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rows } = await serverDB.execute<{ waiting: number }>(
      sql`SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('No transaction started waiting for the channel lock');
};

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: ownerId }, { id: memberId }, { id: outsiderId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Workspace', primaryOwnerId: ownerId, slug: workspaceId });
});

afterEach(async () => {
  await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await serverDB.delete(users).where(inArray(users.id, [ownerId, memberId, outsiderId]));
});

describe('ChannelRepository', () => {
  describe('create', () => {
    it('creates a personal channel with the caller as owner member', async () => {
      const { channel, member } = await new ChannelRepository(serverDB, ownerId).create({
        title: 'Personal',
      });

      expect(channel).toMatchObject({
        userId: ownerId,
        visibility: 'private',
        workspaceId: null,
      });
      expect(member).toMatchObject({
        actorType: 'user',
        channelId: channel.id,
        lastReadSequence: 0,
        role: 'owner',
        userId: ownerId,
      });
      expect(channel.id).toMatch(/^chn_[\dA-Za-z]{12}$/);
      expect(member.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('creates a workspace channel and treats a blank workspace as personal', async () => {
      const { channel } = await new ChannelRepository(serverDB, ownerId, workspaceId).create({
        title: 'Team',
        visibility: 'public',
      });
      const { channel: personal } = await new ChannelRepository(serverDB, ownerId, ' ').create({
        title: 'Blank scope',
      });

      expect(channel).toMatchObject({ visibility: 'public', workspaceId });
      expect(personal.workspaceId).toBeNull();
    });
  });

  describe('membership-based access', () => {
    it('lets every active member read the channel, not just its creator', async () => {
      const { channel } = await new ChannelRepository(serverDB, ownerId, workspaceId).create({
        title: 'Team',
      });
      await addPerson(channel.id, memberId, 'member');

      const asMember = new ChannelRepository(serverDB, memberId, workspaceId);
      expect((await asMember.findAccess(channel.id))?.member.role).toBe('member');
      expect((await asMember.list()).map((item) => item.id)).toEqual([channel.id]);

      const asOutsider = new ChannelRepository(serverDB, outsiderId, workspaceId);
      expect(await asOutsider.findAccess(channel.id)).toBeUndefined();
      expect(await asOutsider.list()).toEqual([]);
    });

    it('hides channels from members who left and from other scopes', async () => {
      const { channel } = await new ChannelRepository(serverDB, ownerId, workspaceId).create({
        title: 'Team',
      });
      await addPerson(channel.id, memberId, 'member');
      await serverDB
        .update(channelMembers)
        .set({ status: 'left' })
        .where(eq(channelMembers.userId, memberId));

      expect(
        await new ChannelRepository(serverDB, memberId, workspaceId).findAccess(channel.id),
      ).toBe(undefined);
      expect(await new ChannelRepository(serverDB, ownerId).findAccess(channel.id)).toBeUndefined();
      expect(await new ChannelRepository(serverDB, ownerId).list()).toEqual([]);
    });

    it('omits trashed channels from the list', async () => {
      const model = new ChannelRepository(serverDB, ownerId);
      const { channel } = await model.create({ title: 'Trashed' });
      await serverDB
        .update(channels)
        .set({ deletedAt: new Date(), isDeleted: true })
        .where(eq(channels.id, channel.id));

      expect(await model.list()).toEqual([]);
    });
  });

  describe('write', () => {
    it('runs the mutation under the channel lock for a member with enough role', async () => {
      const { channel } = await new ChannelRepository(serverDB, ownerId, workspaceId).create({
        title: 'Team',
      });
      await addPerson(channel.id, memberId, 'admin');

      const title = await new ChannelRepository(serverDB, memberId, workspaceId).write(
        channel.id,
        async (tx, access) => {
          await tx.update(channels).set({ title: 'Renamed' }).where(eq(channels.id, channel.id));
          return access.channel.title;
        },
        { minRole: 'admin' },
      );

      const [renamed] = await serverDB.select().from(channels).where(eq(channels.id, channel.id));
      expect(title).toBe('Team');
      expect(renamed.title).toBe('Renamed');
    });

    it('rolls back mutations when the write callback fails', async () => {
      const model = new ChannelRepository(serverDB, ownerId);
      const { channel } = await model.create({ title: 'Personal' });

      await expect(
        model.write(channel.id, async (tx) => {
          await tx
            .update(channels)
            .set({ title: 'Uncommitted' })
            .where(eq(channels.id, channel.id));
          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');
      expect((await model.findAccess(channel.id))?.channel.title).toBe('Personal');
    });

    it('rejects outsiders, insufficient roles and trashed channels', async () => {
      const { channel } = await new ChannelRepository(serverDB, ownerId, workspaceId).create({
        title: 'Team',
      });
      await addPerson(channel.id, memberId, 'member');
      const noop = async () => undefined;

      await expect(
        new ChannelRepository(serverDB, outsiderId, workspaceId).write(channel.id, noop),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        new ChannelRepository(serverDB, memberId, workspaceId).write(channel.id, noop, {
          minRole: 'admin',
        }),
      ).rejects.toBeInstanceOf(ChannelError);

      await serverDB
        .update(channels)
        .set({ deletedAt: new Date(), isDeleted: true })
        .where(eq(channels.id, channel.id));
      const asOwner = new ChannelRepository(serverDB, ownerId, workspaceId);
      await expect(asOwner.write(channel.id, noop)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        asOwner.write(channel.id, async () => 'restored', { allowTrashed: true }),
      ).resolves.toBe('restored');
    });

    it.skipIf(!isServerDB)(
      'checks membership as committed by the previous lock holder',
      async () => {
        const { channel } = await new ChannelRepository(serverDB, ownerId, workspaceId).create({
          title: 'Team',
        });
        await addPerson(channel.id, memberId, 'admin');

        let removed!: () => void;
        const memberRemoved = new Promise<void>((resolve) => (removed = resolve));
        let release!: () => void;
        const released = new Promise<void>((resolve) => (release = resolve));
        const removal = new ChannelRepository(serverDB, ownerId, workspaceId).write(
          channel.id,
          async (tx) => {
            await tx
              .update(channelMembers)
              .set({ status: 'removed' })
              .where(eq(channelMembers.userId, memberId));
            removed();
            await released;
          },
        );

        await memberRemoved;
        const staleWrite = new ChannelRepository(serverDB, memberId, workspaceId).write(
          channel.id,
          async () => 'wrote',
          { minRole: 'admin' },
        );
        // Settle the promise early so a rejection is never reported as unhandled.
        const staleResult = staleWrite.then(
          () => 'wrote',
          (error: ChannelError) => error.code,
        );
        await waitForLockWaiter();
        release();
        await removal;

        expect(await staleResult).toBe('NOT_FOUND');
      },
    );
  });

  describe('account deletion', () => {
    it('deletes personal channels and direct conversations, keeping workspace groups without a creator', async () => {
      const { channel: personal } = await new ChannelRepository(serverDB, memberId).create({
        title: 'Personal',
      });
      // Owned by someone else, so the Agent cascade cannot hide a missing cleanup.
      const [agent] = await serverDB
        .insert(agents)
        .values({ userId: ownerId, workspaceId })
        .returning();
      const { channel: direct } = await new ChannelRepository(
        serverDB,
        memberId,
        workspaceId,
      ).create({ agentId: agent.id, title: 'Direct' });
      const { channel: team } = await new ChannelRepository(serverDB, memberId, workspaceId).create(
        {
          title: 'Team',
        },
      );
      await addPerson(team.id, ownerId, 'member');

      await UserModel.deleteUser(serverDB, memberId);

      const remaining = await serverDB
        .select()
        .from(channels)
        .where(inArray(channels.id, [personal.id, direct.id, team.id]));
      expect(remaining).toEqual([expect.objectContaining({ userId: null, id: team.id })]);
      expect(
        (await new ChannelRepository(serverDB, ownerId, workspaceId).findAccess(team.id))?.channel
          .id,
      ).toBe(team.id);
    });
  });
});
