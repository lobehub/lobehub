// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { sessionGroups, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { SessionGroupModel } from '../sessionGroup';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'session-group-model-test-user-id';
const sessionGroupModel = new SessionGroupModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: 'user2' }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(sessionGroups).where(eq(sessionGroups.userId, userId));
});

describe('SessionGroupModel', () => {
  describe('create', () => {
    it('should create a new session group', async () => {
      const params = {
        name: 'Test Group',
        sort: 1,
      };

      const result = await sessionGroupModel.create(params);
      expect(result.id).toBeDefined();
      expect(result).toMatchObject({ ...params, userId });

      const group = await serverDB.query.sessionGroups.findFirst({
        where: eq(sessionGroups.id, result.id),
      });
      expect(group).toMatchObject({ ...params, userId });
    });
  });
  describe('delete', () => {
    it('should delete a session group by id', async () => {
      const { id } = await sessionGroupModel.create({ name: 'Test Group' });

      await sessionGroupModel.delete(id);

      const group = await serverDB.query.sessionGroups.findFirst({
        where: eq(sessionGroups.id, id),
      });
      expect(group).toBeUndefined();
    });
  });
  describe('deleteAll', () => {
    it('should delete all session groups for the user', async () => {
      await sessionGroupModel.create({ name: 'Test Group 1' });
      await sessionGroupModel.create({ name: 'Test Group 2' });

      await sessionGroupModel.deleteAll();

      const userGroups = await serverDB.query.sessionGroups.findMany({
        where: eq(sessionGroups.userId, userId),
      });
      expect(userGroups).toHaveLength(0);
    });
    it('should only delete session groups for the user, not others', async () => {
      await sessionGroupModel.create({ name: 'Test Group 1' });
      await sessionGroupModel.create({ name: 'Test Group 333' });

      const anotherSessionGroupModel = new SessionGroupModel(serverDB, 'user2');
      await anotherSessionGroupModel.create({ name: 'Test Group 2' });

      await sessionGroupModel.deleteAll();

      const userGroups = await serverDB.query.sessionGroups.findMany({
        where: eq(sessionGroups.userId, userId),
      });
      const total = await serverDB.query.sessionGroups.findMany();
      expect(userGroups).toHaveLength(0);
      expect(total).toHaveLength(1);
    });
  });

  describe('query', () => {
    it('should query session groups for the user', async () => {
      await sessionGroupModel.create({ name: 'Test Group 1', sort: 2 });
      await sessionGroupModel.create({ name: 'Test Group 2', sort: 1 });

      const userGroups = await sessionGroupModel.query();
      expect(userGroups).toHaveLength(2);
      expect(userGroups[0].name).toBe('Test Group 2');
      expect(userGroups[1].name).toBe('Test Group 1');
    });
  });

  describe('findById', () => {
    it('should find a session group by id', async () => {
      const { id } = await sessionGroupModel.create({ name: 'Test Group' });

      const group = await sessionGroupModel.findById(id);
      expect(group).toMatchObject({
        id,
        name: 'Test Group',
        userId,
      });
    });
  });

  describe('update', () => {
    it('should update a session group', async () => {
      const { id } = await sessionGroupModel.create({ name: 'Test Group' });

      await sessionGroupModel.update(id, { name: 'Updated Test Group', sort: 3 });

      const updatedGroup = await serverDB.query.sessionGroups.findFirst({
        where: eq(sessionGroups.id, id),
      });
      expect(updatedGroup).toMatchObject({
        id,
        name: 'Updated Test Group',
        sort: 3,
        userId,
      });
    });
  });

  describe('updateOrder', () => {
    it('should update order of session groups', async () => {
      const group1 = await sessionGroupModel.create({ name: 'Test Group 1', sort: 1 });
      const group2 = await sessionGroupModel.create({ name: 'Test Group 2', sort: 2 });

      await sessionGroupModel.updateOrder([
        { id: group1.id, sort: 3 },
        { id: group2.id, sort: 4 },
      ]);

      const updatedGroup1 = await serverDB.query.sessionGroups.findFirst({
        where: eq(sessionGroups.id, group1.id),
      });
      const updatedGroup2 = await serverDB.query.sessionGroups.findFirst({
        where: eq(sessionGroups.id, group2.id),
      });

      expect(updatedGroup1?.sort).toBe(3);
      expect(updatedGroup2?.sort).toBe(4);
    });
  });

  describe('workspace visibility', () => {
    const wsId = 'session-group-ws';
    const ownerId = userId;
    const memberId = 'user2';
    const ownerModel = new SessionGroupModel(serverDB, ownerId, wsId);
    const memberModel = new SessionGroupModel(serverDB, memberId, wsId);

    beforeEach(async () => {
      await serverDB.insert(workspaces).values({
        id: wsId,
        name: 'Session Group WS',
        slug: 'session-group-ws',
        primaryOwnerId: ownerId,
      });
    });

    afterEach(async () => {
      await serverDB.delete(workspaces).where(eq(workspaces.id, wsId));
    });

    describe('create with visibility', () => {
      it('should persist private visibility when explicitly requested', async () => {
        const result = await ownerModel.create({ name: 'Private Folder', visibility: 'private' });

        const row = await serverDB.query.sessionGroups.findFirst({
          where: eq(sessionGroups.id, result.id),
        });
        expect(row?.visibility).toBe('private');
        expect(row?.workspaceId).toBe(wsId);
        expect(row?.userId).toBe(ownerId);
      });

      it('should default to public visibility when omitted', async () => {
        const result = await ownerModel.create({ name: 'Public Folder' });

        const row = await serverDB.query.sessionGroups.findFirst({
          where: eq(sessionGroups.id, result.id),
        });
        expect(row?.visibility).toBe('public');
      });
    });

    describe('ownership visibility filter', () => {
      it('should let another member see public folders but not the owner’s private folder', async () => {
        const ownerPrivate = await ownerModel.create({
          name: 'Owner Private',
          visibility: 'private',
        });
        const ownerPublic = await ownerModel.create({
          name: 'Owner Public',
          visibility: 'public',
        });
        const memberPrivate = await memberModel.create({
          name: 'Member Private',
          visibility: 'private',
        });

        const seenByMember = await memberModel.query();
        const ids = seenByMember.map((row) => row.id).sort();

        expect(ids).toContain(ownerPublic.id);
        expect(ids).toContain(memberPrivate.id);
        expect(ids).not.toContain(ownerPrivate.id);
      });

      it('should return undefined when a member reads another member’s private folder by id', async () => {
        const ownerPrivate = await ownerModel.create({
          name: 'Owner Private',
          visibility: 'private',
        });

        const found = await memberModel.findById(ownerPrivate.id);
        expect(found).toBeUndefined();
      });
    });

    describe('publishToWorkspace', () => {
      it('should flip the creator’s own private folder to public', async () => {
        const created = await ownerModel.create({
          name: 'To Publish',
          visibility: 'private',
        });

        await ownerModel.publishToWorkspace(created.id);

        const row = await serverDB.query.sessionGroups.findFirst({
          where: eq(sessionGroups.id, created.id),
        });
        expect(row?.visibility).toBe('public');
      });

      it('should be a no-op when the row is already public', async () => {
        const created = await ownerModel.create({
          name: 'Already Public',
          visibility: 'public',
        });
        const before = await serverDB.query.sessionGroups.findFirst({
          where: eq(sessionGroups.id, created.id),
        });

        await ownerModel.publishToWorkspace(created.id);

        const after = await serverDB.query.sessionGroups.findFirst({
          where: eq(sessionGroups.id, created.id),
        });
        expect(after?.visibility).toBe('public');
        expect(after?.updatedAt).toEqual(before?.updatedAt);
      });

      it('should refuse to publish another member’s private folder', async () => {
        const owned = await ownerModel.create({
          name: 'Owner Private',
          visibility: 'private',
        });

        await memberModel.publishToWorkspace(owned.id);

        const row = await serverDB.query.sessionGroups.findFirst({
          where: eq(sessionGroups.id, owned.id),
        });
        expect(row?.visibility).toBe('private');
        expect(row?.userId).toBe(ownerId);
      });
    });
  });
});
