// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sleep } from '@/utils/sleep';

import {
  NewKnowledgeBase,
  files,
  globalFiles,
  knowledgeBaseFiles,
  knowledgeBases,
  users,
} from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { KnowledgeBaseModel } from '../knowledgeBase';
import { getTestDB } from '../../core/getTestDB';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'session-group-model-test-user-id';
const knowledgeBaseModel = new KnowledgeBaseModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(globalFiles);
  await serverDB.insert(users).values([{ id: userId }, { id: 'user2' }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(knowledgeBases).where(eq(knowledgeBases.userId, userId));
});

describe('KnowledgeBaseModel', () => {
  describe('create', () => {
    it('should create a new knowledge base', async () => {
      const params = {
        name: 'Test Group',
      } as NewKnowledgeBase;

      const result = await knowledgeBaseModel.create(params);
      expect(result.id).toBeDefined();
      expect(result).toMatchObject({ ...params, userId });

      const group = await serverDB.query.knowledgeBases.findFirst({
        where: eq(knowledgeBases.id, result.id),
      });
      expect(group).toMatchObject({ ...params, userId });
    });
  });
  describe('delete', () => {
    it('should delete a knowledge base by id', async () => {
      const { id } = await knowledgeBaseModel.create({ name: 'Test Group' });

      await knowledgeBaseModel.delete(id);

      const group = await serverDB.query.knowledgeBases.findFirst({
        where: eq(knowledgeBases.id, id),
      });
      expect(group).toBeUndefined();
    });
  });
  describe('deleteAll', () => {
    it('should delete all knowledge bases for the user', async () => {
      await knowledgeBaseModel.create({ name: 'Test Group 1' });
      await knowledgeBaseModel.create({ name: 'Test Group 2' });

      await knowledgeBaseModel.deleteAll();

      const userGroups = await serverDB.query.knowledgeBases.findMany({
        where: eq(knowledgeBases.userId, userId),
      });
      expect(userGroups).toHaveLength(0);
    });
    it('should only delete knowledge bases for the user, not others', async () => {
      await knowledgeBaseModel.create({ name: 'Test Group 1' });
      await knowledgeBaseModel.create({ name: 'Test Group 333' });

      const anotherSessionGroupModel = new KnowledgeBaseModel(serverDB, 'user2');
      await anotherSessionGroupModel.create({ name: 'Test Group 2' });

      await knowledgeBaseModel.deleteAll();

      const userGroups = await serverDB.query.knowledgeBases.findMany({
        where: eq(knowledgeBases.userId, userId),
      });
      const total = await serverDB.query.knowledgeBases.findMany();
      expect(userGroups).toHaveLength(0);
      expect(total).toHaveLength(1);
    });
  });

  describe('query', () => {
    it('should query knowledge bases for the user', async () => {
      await knowledgeBaseModel.create({ name: 'Test Group 1' });
      await sleep(50);
      await knowledgeBaseModel.create({ name: 'Test Group 2' });

      const userGroups = await knowledgeBaseModel.query();
      expect(userGroups).toHaveLength(2);
      expect(userGroups[0].name).toBe('Test Group 2');
      expect(userGroups[1].name).toBe('Test Group 1');
    });
  });

  describe('findById', () => {
    it('should find a knowledge base by id', async () => {
      const { id } = await knowledgeBaseModel.create({ name: 'Test Group' });

      const group = await knowledgeBaseModel.findById(id);
      expect(group).toMatchObject({
        id,
        name: 'Test Group',
        userId,
      });
    });
  });

  describe('update', () => {
    it('should update a knowledge base', async () => {
      const { id } = await knowledgeBaseModel.create({ name: 'Test Group' });

      await knowledgeBaseModel.update(id, { name: 'Updated Test Group' });

      const updatedGroup = await serverDB.query.knowledgeBases.findFirst({
        where: eq(knowledgeBases.id, id),
      });
      expect(updatedGroup).toMatchObject({
        id,
        name: 'Updated Test Group',
        userId,
      });
    });
  });

  const fileList = [
    {
      id: 'file1',
      name: 'document.pdf',
      url: 'https://example.com/document.pdf',
      fileHash: 'hash1',
      size: 1000,
      fileType: 'application/pdf',
      userId,
    },
    {
      id: 'file2',
      name: 'image.jpg',
      url: 'https://example.com/image.jpg',
      fileHash: 'hash2',
      size: 500,
      fileType: 'image/jpeg',
      userId,
    },
  ];

  describe('addFilesToKnowledgeBase', () => {
    it('should add files to a knowledge base', async () => {
      await serverDB.insert(globalFiles).values([
        {
          hashId: 'hash1',
          url: 'https://example.com/document.pdf',
          size: 1000,
          fileType: 'application/pdf',
          creator: userId,
        },
        {
          hashId: 'hash2',
          url: 'https://example.com/image.jpg',
          size: 500,
          fileType: 'image/jpeg',
          creator: userId,
        },
      ]);

      await serverDB.insert(files).values(fileList);

      const { id: knowledgeBaseId } = await knowledgeBaseModel.create({ name: 'Test Group' });
      const fileIds = ['file1', 'file2'];

      const result = await knowledgeBaseModel.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);

      expect(result).toHaveLength(2);
      expect(result).toEqual(
        expect.arrayContaining(
          fileIds.map((fileId) => expect.objectContaining({ fileId, knowledgeBaseId })),
        ),
      );

      const addedFiles = await serverDB.query.knowledgeBaseFiles.findMany({
        where: eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
      });
      expect(addedFiles).toHaveLength(2);
    });
  });

  describe('removeFilesFromKnowledgeBase', () => {
    it('should remove files from a knowledge base', async () => {
      await serverDB.insert(globalFiles).values([
        {
          hashId: 'hash1',
          url: 'https://example.com/document.pdf',
          size: 1000,
          fileType: 'application/pdf',
          creator: userId,
        },
        {
          hashId: 'hash2',
          url: 'https://example.com/image.jpg',
          size: 500,
          fileType: 'image/jpeg',
          creator: userId,
        },
      ]);

      await serverDB.insert(files).values(fileList);

      const { id: knowledgeBaseId } = await knowledgeBaseModel.create({ name: 'Test Group' });
      const fileIds = ['file1', 'file2'];
      await knowledgeBaseModel.addFilesToKnowledgeBase(knowledgeBaseId, fileIds);

      const filesToRemove = ['file1'];
      await knowledgeBaseModel.removeFilesFromKnowledgeBase(knowledgeBaseId, filesToRemove);

      const remainingFiles = await serverDB.query.knowledgeBaseFiles.findMany({
        where: and(eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId)),
      });
      expect(remainingFiles).toHaveLength(1);
      expect(remainingFiles[0].fileId).toBe('file2');
    });

    it('should not allow removing files from another user knowledge base', async () => {
      await serverDB.insert(globalFiles).values([
        {
          hashId: 'hash1',
          url: 'https://example.com/document.pdf',
          size: 1000,
          fileType: 'application/pdf',
          creator: userId,
        },
      ]);

      await serverDB.insert(files).values([fileList[0]]);

      const { id: knowledgeBaseId } = await knowledgeBaseModel.create({ name: 'Test Group' });
      await knowledgeBaseModel.addFilesToKnowledgeBase(knowledgeBaseId, ['file1']);

      // Another user tries to remove files from this knowledge base
      const attackerModel = new KnowledgeBaseModel(serverDB, 'user2');
      await attackerModel.removeFilesFromKnowledgeBase(knowledgeBaseId, ['file1']);

      // Files should still exist since the attacker doesn't own them
      const remainingFiles = await serverDB.query.knowledgeBaseFiles.findMany({
        where: eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
      });
      expect(remainingFiles).toHaveLength(1);
      expect(remainingFiles[0].fileId).toBe('file1');
    });
  });

  describe('static findById', () => {
    it('should find a knowledge base by id without user restriction', async () => {
      const { id } = await knowledgeBaseModel.create({ name: 'Test Group' });

      const group = await KnowledgeBaseModel.findById(serverDB, id);
      expect(group).toMatchObject({
        id,
        name: 'Test Group',
        userId,
      });
    });

    it('should find a knowledge base created by another user', async () => {
      const anotherKnowledgeBaseModel = new KnowledgeBaseModel(serverDB, 'user2');
      const { id } = await anotherKnowledgeBaseModel.create({ name: 'Another User Group' });

      const group = await KnowledgeBaseModel.findById(serverDB, id);
      expect(group).toMatchObject({
        id,
        name: 'Another User Group',
        userId: 'user2',
      });
    });
  });
});
