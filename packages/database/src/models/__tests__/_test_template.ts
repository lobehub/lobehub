// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { sessionGroups, users } from '../../schemas';
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
});
