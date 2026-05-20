// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sleep } from '@/utils/sleep';

import { getTestDB } from '../../core/getTestDB';
import type { NewKnowledgeBase } from '../../schemas';
import {
  documents,
  files,
  globalFiles,
  knowledgeBaseFiles,
  knowledgeBases,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { KnowledgeBaseModel } from '../knowledgeBase';

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

    it('should add documents (with docs_ prefix) to a knowledge base by resolving to file IDs', async () => {
      await serverDB.insert(globalFiles).values([
        {
          hashId: 'hash1',
          url: 'https://example.com/document.pdf',
          size: 1000,
          fileType: 'application/pdf',
          creator: userId,
        },
      ]);

      // Create mirror file first (document references it via fileId)
      await serverDB.insert(files).values([
        {
          id: 'file1',
          name: 'document.pdf',
          url: 'https://example.com/document.pdf',
          fileHash: 'hash1',
          size: 1000,
          fileType: 'application/pdf',
          userId,
        },
      ]);

      // Create document with fileId pointing to the mirror file
      await serverDB.insert(documents).values([
        {
          id: 'docs_test123',
          title: 'Test Document',
          content: 'Test content',
          fileType: 'application/pdf',
          totalCharCount: 100,
          totalLineCount: 10,
          sourceType: 'file',
          source: 'test.pdf',
          fileId: 'file1',
          userId,
        },
      ]);

      const { id: knowledgeBaseId } = await knowledgeBaseModel.create({ name: 'Test Group' });

      // Pass document ID (with docs_ prefix)
      const result = await knowledgeBaseModel.addFilesToKnowledgeBase(knowledgeBaseId, [
        'docs_test123',
      ]);

      // Should resolve to file1 and insert that
      expect(result).toHaveLength(1);
      expect(result[0].fileId).toBe('file1');
      expect(result[0].knowledgeBaseId).toBe(knowledgeBaseId);

      const addedFiles = await serverDB.query.knowledgeBaseFiles.findMany({
        where: eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
      });
      expect(addedFiles).toHaveLength(1);
      expect(addedFiles[0].fileId).toBe('file1');

      // Verify document.knowledgeBaseId was updated
      const document = await serverDB.query.documents.findFirst({
        where: eq(documents.id, 'docs_test123'),
      });
      expect(document?.knowledgeBaseId).toBe(knowledgeBaseId);
    });

    it('should return empty array when all document IDs resolve to null fileIds', async () => {
      // Create a document without a fileId (fileId is null)
      await serverDB.insert(documents).values([
        {
          id: 'docs_no_file',
          title: 'Document without file',
          content: 'Test content',
          fileType: 'text/plain',
          totalCharCount: 50,
          totalLineCount: 5,
          sourceType: 'file',
          source: 'test.txt',
          fileId: null,
          userId,
        },
      ]);

      const { id: knowledgeBaseId } = await knowledgeBaseModel.create({ name: 'Test Group' });

      // Pass only document IDs whose fileId is null => resolvedFileIds will be empty
      const result = await knowledgeBaseModel.addFilesToKnowledgeBase(knowledgeBaseId, [
        'docs_no_file',
      ]);

      expect(result).toEqual([]);

      // Verify no files were added to the knowledge base
      const addedFiles = await serverDB.query.knowledgeBaseFiles.findMany({
        where: eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
      });
      expect(addedFiles).toHaveLength(0);
    });

    it("should NOT allow adding files to another user's knowledge base (IDOR)", async () => {
      // Setup: victim creates a knowledge base
      const victimModel = new KnowledgeBaseModel(serverDB, 'user2');
      const { id: victimKbId } = await victimModel.create({ name: 'Victim KB' });

      // Setup: attacker uploads their own file
      await serverDB.insert(globalFiles).values([
        {
          hashId: 'hash_attacker',
          url: 'https://example.com/malicious.pdf',
          size: 1000,
          fileType: 'application/pdf',
          creator: userId,
        },
      ]);
      await serverDB.insert(files).values([
        {
          id: 'file_attacker',
          name: 'malicious.pdf',
          url: 'https://example.com/malicious.pdf',
          fileHash: 'hash_attacker',
          size: 1000,
          fileType: 'application/pdf',
          userId, // attacker's file
        },
      ]);

      // Attack: attacker tries to add their file to victim's knowledge base
      const result = await knowledgeBaseModel.addFilesToKnowledgeBase(victimKbId, [
        'file_attacker',
      ]);

      // The operation should be rejected - no files should be inserted
      expect(result).toHaveLength(0);

      // Verify no files were added to victim's knowledge base
      const kbFiles = await serverDB.query.knowledgeBaseFiles.findMany({
        where: eq(knowledgeBaseFiles.knowledgeBaseId, victimKbId),
      });
      expect(kbFiles).toHaveLength(0);
    });

    it("should NOT allow adding documents to another user's knowledge base (IDOR)", async () => {
      // Setup: victim creates a knowledge base
      const victimModel = new KnowledgeBaseModel(serverDB, 'user2');
      const { id: victimKbId } = await victimModel.create({ name: 'Victim KB' });

      // Setup: attacker has a document with a mirror file
      await serverDB.insert(globalFiles).values([
        {
          hashId: 'hash_attacker_doc',
          url: 'https://example.com/malicious_doc.pdf',
          size: 1000,
          fileType: 'application/pdf',
          creator: userId,
        },
      ]);
      await serverDB.insert(files).values([
        {
          id: 'file_attacker_doc',
          name: 'malicious_doc.pdf',
          url: 'https://example.com/malicious_doc.pdf',
          fileHash: 'hash_attacker_doc',
          size: 1000,
          fileType: 'application/pdf',
          userId,
        },
      ]);
      await serverDB.insert(documents).values([
        {
          id: 'docs_attacker',
          title: 'Malicious Document',
          content: 'Injected content',
          fileType: 'application/pdf',
          totalCharCount: 100,
          totalLineCount: 10,
          sourceType: 'file',
          source: 'malicious.pdf',
          fileId: 'file_attacker_doc',
          userId,
        },
      ]);

      // Attack: attacker tries to add their document to victim's knowledge base
      const result = await knowledgeBaseModel.addFilesToKnowledgeBase(victimKbId, [
        'docs_attacker',
      ]);

      // The operation should be rejected
      expect(result).toHaveLength(0);

      // Verify no files were added to victim's knowledge base
      const kbFiles = await serverDB.query.knowledgeBaseFiles.findMany({
        where: eq(knowledgeBaseFiles.knowledgeBaseId, victimKbId),
      });
      expect(kbFiles).toHaveLength(0);

      // Verify the document's knowledgeBaseId was NOT updated to victim's KB
      const doc = await serverDB.query.documents.findFirst({
        where: eq(documents.id, 'docs_attacker'),
      });
      expect(doc?.knowledgeBaseId).toBeNull();
    });

    it('should handle mixed document IDs and file IDs', async () => {
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

      // Create files - file1 is mirror of the document, file2 is standalone
      await serverDB.insert(files).values([
        {
          id: 'file1',
          name: 'document.pdf',
          url: 'https://example.com/document.pdf',
          fileHash: 'hash1',
          size: 1000,
          fileType: 'application/pdf',
          userId,
        },
        fileList[1], // file2 - standalone file
      ]);

      // Create document with fileId pointing to the mirror file
      await serverDB.insert(documents).values([
        {
          id: 'docs_test456',
          title: 'Test Document',
          content: 'Test content',
          fileType: 'application/pdf',
          totalCharCount: 100,
          totalLineCount: 10,
          sourceType: 'file',
          source: 'test.pdf',
          fileId: 'file1',
          userId,
        },
      ]);

      const { id: knowledgeBaseId } = await knowledgeBaseModel.create({ name: 'Test Group' });

      // Mix of document ID and direct file ID
      const result = await knowledgeBaseModel.addFilesToKnowledgeBase(knowledgeBaseId, [
        'docs_test456',
        'file2',
      ]);

      expect(result).toHaveLength(2);
      const fileIds = result.map((r) => r.fileId).sort();
      expect(fileIds).toEqual(['file1', 'file2']);
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

    it('should remove documents (with docs_ prefix) from a knowledge base by resolving to file IDs', async () => {
      await serverDB.insert(globalFiles).values([
        {
          hashId: 'hash1',
          url: 'https://example.com/document.pdf',
          size: 1000,
          fileType: 'application/pdf',
          creator: userId,
        },
      ]);

      // Create mirror file first (document references it via fileId)
      await serverDB.insert(files).values([
        {
          id: 'file1',
          name: 'document.pdf',
          url: 'https://example.com/document.pdf',
          fileHash: 'hash1',
          size: 1000,
          fileType: 'application/pdf',
          userId,
        },
      ]);

      // Create document with fileId pointing to the mirror file
      await serverDB.insert(documents).values([
        {
          id: 'docs_test789',
          title: 'Test Document',
          content: 'Test content',
          fileType: 'application/pdf',
          totalCharCount: 100,
          totalLineCount: 10,
          sourceType: 'file',
          source: 'test.pdf',
          fileId: 'file1',
          userId,
        },
      ]);

      const { id: knowledgeBaseId } = await knowledgeBaseModel.create({ name: 'Test Group' });
      await knowledgeBaseModel.addFilesToKnowledgeBase(knowledgeBaseId, ['docs_test789']);

      // Remove using document ID
      await knowledgeBaseModel.removeFilesFromKnowledgeBase(knowledgeBaseId, ['docs_test789']);

      const remainingFiles = await serverDB.query.knowledgeBaseFiles.findMany({
        where: eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
      });
      expect(remainingFiles).toHaveLength(0);

      // Verify document.knowledgeBaseId was cleared
      const document = await serverDB.query.documents.findFirst({
        where: eq(documents.id, 'docs_test789'),
      });
      expect(document?.knowledgeBaseId).toBeNull();
    });

    it('should handle removing document IDs that resolve to null fileIds (empty resolvedFileIds)', async () => {
      await serverDB.insert(globalFiles).values([
        {
          hashId: 'hash1',
          url: 'https://example.com/document.pdf',
          size: 1000,
          fileType: 'application/pdf',
          creator: userId,
        },
      ]);

      await serverDB.insert(files).values([
        {
          id: 'file1',
          name: 'document.pdf',
          url: 'https://example.com/document.pdf',
          fileHash: 'hash1',
          size: 1000,
          fileType: 'application/pdf',
          userId,
        },
      ]);

      const { id: knowledgeBaseId } = await knowledgeBaseModel.create({ name: 'Test Group' });
      await knowledgeBaseModel.addFilesToKnowledgeBase(knowledgeBaseId, ['file1']);

      // Create a document without a fileId (fileId is null)
      await serverDB.insert(documents).values([
        {
          id: 'docs_null_file',
          title: 'Document without file',
          content: 'Test content',
          fileType: 'text/plain',
          totalCharCount: 50,
          totalLineCount: 5,
          sourceType: 'file',
          source: 'test.txt',
          fileId: null,
          knowledgeBaseId,
          userId,
        },
      ]);

      // Try to remove using only a document ID whose fileId is null
      // resolvedFileIds will be empty after filtering, so the early return on line 109-111 is hit
      await knowledgeBaseModel.removeFilesFromKnowledgeBase(knowledgeBaseId, ['docs_null_file']);

      // The existing file should still be in the knowledge base
      const remainingFiles = await serverDB.query.knowledgeBaseFiles.findMany({
        where: eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
      });
      expect(remainingFiles).toHaveLength(1);
      expect(remainingFiles[0].fileId).toBe('file1');
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

  describe('findExclusiveFileIds', () => {
    it('should return file IDs that belong only to this knowledge base', async () => {
      await serverDB.insert(globalFiles).values([
        {
          hashId: 'hash1',
          url: 'https://example.com/a.pdf',
          size: 100,
          fileType: 'application/pdf',
          creator: userId,
        },
        {
          hashId: 'hash2',
          url: 'https://example.com/b.pdf',
          size: 200,
          fileType: 'application/pdf',
          creator: userId,
        },
      ]);
      await serverDB.insert(files).values([
        {
          id: 'file1',
          name: 'a.pdf',
          url: 'https://example.com/a.pdf',
          fileHash: 'hash1',
          size: 100,
          fileType: 'application/pdf',
          userId,
        },
        {
          id: 'file2',
          name: 'b.pdf',
          url: 'https://example.com/b.pdf',
          fileHash: 'hash2',
          size: 200,
          fileType: 'application/pdf',
          userId,
        },
      ]);
      const { id: kb1 } = await knowledgeBaseModel.create({ name: 'KB1' });
      const { id: kb2 } = await knowledgeBaseModel.create({ name: 'KB2' });
      await knowledgeBaseModel.addFilesToKnowledgeBase(kb1, ['file1', 'file2']);
      await knowledgeBaseModel.addFilesToKnowledgeBase(kb2, ['file1']);
      const exclusiveIds = await knowledgeBaseModel.findExclusiveFileIds(kb1);
      expect(exclusiveIds).toEqual(['file2']);
    });

    it('should return empty array when all files are shared', async () => {
      await serverDB
        .insert(globalFiles)
        .values([
          {
            hashId: 'hash1',
            url: 'https://example.com/a.pdf',
            size: 100,
            fileType: 'application/pdf',
            creator: userId,
          },
        ]);
      await serverDB
        .insert(files)
        .values([
          {
            id: 'file1',
            name: 'a.pdf',
            url: 'https://example.com/a.pdf',
            fileHash: 'hash1',
            size: 100,
            fileType: 'application/pdf',
            userId,
          },
        ]);
      const { id: kb1 } = await knowledgeBaseModel.create({ name: 'KB1' });
      const { id: kb2 } = await knowledgeBaseModel.create({ name: 'KB2' });
      await knowledgeBaseModel.addFilesToKnowledgeBase(kb1, ['file1']);
      await knowledgeBaseModel.addFilesToKnowledgeBase(kb2, ['file1']);
      const exclusiveIds = await knowledgeBaseModel.findExclusiveFileIds(kb1);
      expect(exclusiveIds).toEqual([]);
    });

    it('should return all files when none are shared', async () => {
      await serverDB.insert(globalFiles).values([
        {
          hashId: 'hash1',
          url: 'https://example.com/a.pdf',
          size: 100,
          fileType: 'application/pdf',
          creator: userId,
        },
        {
          hashId: 'hash2',
          url: 'https://example.com/b.pdf',
          size: 200,
          fileType: 'application/pdf',
          creator: userId,
        },
      ]);
      await serverDB.insert(files).values([
        {
          id: 'file1',
          name: 'a.pdf',
          url: 'https://example.com/a.pdf',
          fileHash: 'hash1',
          size: 100,
          fileType: 'application/pdf',
          userId,
        },
        {
          id: 'file2',
          name: 'b.pdf',
          url: 'https://example.com/b.pdf',
          fileHash: 'hash2',
          size: 200,
          fileType: 'application/pdf',
          userId,
        },
      ]);
      const { id: kb1 } = await knowledgeBaseModel.create({ name: 'KB1' });
      await knowledgeBaseModel.addFilesToKnowledgeBase(kb1, ['file1', 'file2']);
      const exclusiveIds = await knowledgeBaseModel.findExclusiveFileIds(kb1);
      expect(exclusiveIds.sort()).toEqual(['file1', 'file2']);
    });

    it('should return empty array when KB has no files', async () => {
      const { id: kb1 } = await knowledgeBaseModel.create({ name: 'Empty KB' });
      const exclusiveIds = await knowledgeBaseModel.findExclusiveFileIds(kb1);
      expect(exclusiveIds).toEqual([]);
    });
  });

  describe('deleteWithFiles', () => {
    it('should delete KB and its exclusive files', async () => {
      await serverDB
        .insert(globalFiles)
        .values([
          {
            hashId: 'hash1',
            url: 'https://example.com/a.pdf',
            size: 100,
            fileType: 'application/pdf',
            creator: userId,
          },
        ]);
      await serverDB
        .insert(files)
        .values([
          {
            id: 'file1',
            name: 'a.pdf',
            url: 'https://example.com/a.pdf',
            fileHash: 'hash1',
            size: 100,
            fileType: 'application/pdf',
            userId,
          },
        ]);
      const { id: kbId } = await knowledgeBaseModel.create({ name: 'KB1' });
      await knowledgeBaseModel.addFilesToKnowledgeBase(kbId, ['file1']);
      const result = await knowledgeBaseModel.deleteWithFiles(kbId);
      expect(
        await serverDB.query.knowledgeBases.findFirst({ where: eq(knowledgeBases.id, kbId) }),
      ).toBeUndefined();
      expect(
        await serverDB.query.files.findFirst({ where: eq(files.id, 'file1') }),
      ).toBeUndefined();
      const kbFiles = await serverDB.query.knowledgeBaseFiles.findMany({
        where: eq(knowledgeBaseFiles.knowledgeBaseId, kbId),
      });
      expect(kbFiles).toHaveLength(0);
      expect(result.deletedFiles).toHaveLength(1);
    });

    it('should NOT delete files shared with another KB', async () => {
      await serverDB.insert(globalFiles).values([
        {
          hashId: 'hash1',
          url: 'https://example.com/a.pdf',
          size: 100,
          fileType: 'application/pdf',
          creator: userId,
        },
        {
          hashId: 'hash2',
          url: 'https://example.com/b.pdf',
          size: 200,
          fileType: 'application/pdf',
          creator: userId,
        },
      ]);
      await serverDB.insert(files).values([
        {
          id: 'file1',
          name: 'a.pdf',
          url: 'https://example.com/a.pdf',
          fileHash: 'hash1',
          size: 100,
          fileType: 'application/pdf',
          userId,
        },
        {
          id: 'file2',
          name: 'b.pdf',
          url: 'https://example.com/b.pdf',
          fileHash: 'hash2',
          size: 200,
          fileType: 'application/pdf',
          userId,
        },
      ]);
      const { id: kb1 } = await knowledgeBaseModel.create({ name: 'KB1' });
      const { id: kb2 } = await knowledgeBaseModel.create({ name: 'KB2' });
      await knowledgeBaseModel.addFilesToKnowledgeBase(kb1, ['file1', 'file2']);
      await knowledgeBaseModel.addFilesToKnowledgeBase(kb2, ['file1']);
      const result = await knowledgeBaseModel.deleteWithFiles(kb1);
      expect(
        await serverDB.query.knowledgeBases.findFirst({ where: eq(knowledgeBases.id, kb1) }),
      ).toBeUndefined();
      expect(await serverDB.query.files.findFirst({ where: eq(files.id, 'file1') })).toBeDefined();
      expect(
        await serverDB.query.files.findFirst({ where: eq(files.id, 'file2') }),
      ).toBeUndefined();
      const kb2Files = await serverDB.query.knowledgeBaseFiles.findMany({
        where: eq(knowledgeBaseFiles.knowledgeBaseId, kb2),
      });
      expect(kb2Files).toHaveLength(1);
      expect(kb2Files[0].fileId).toBe('file1');
      expect(result.deletedFiles).toHaveLength(1);
    });

    it('should handle KB with no files', async () => {
      const { id: kbId } = await knowledgeBaseModel.create({ name: 'Empty KB' });
      const result = await knowledgeBaseModel.deleteWithFiles(kbId);
      expect(
        await serverDB.query.knowledgeBases.findFirst({ where: eq(knowledgeBases.id, kbId) }),
      ).toBeUndefined();
      expect(result.deletedFiles).toHaveLength(0);
    });
  });

  describe('deleteAllWithFiles', () => {
    it('should delete all KBs and their exclusive files', async () => {
      await serverDB.insert(globalFiles).values([
        {
          hashId: 'hash1',
          url: 'https://example.com/a.pdf',
          size: 100,
          fileType: 'application/pdf',
          creator: userId,
        },
        {
          hashId: 'hash2',
          url: 'https://example.com/b.pdf',
          size: 200,
          fileType: 'application/pdf',
          creator: userId,
        },
      ]);
      await serverDB.insert(files).values([
        {
          id: 'file1',
          name: 'a.pdf',
          url: 'https://example.com/a.pdf',
          fileHash: 'hash1',
          size: 100,
          fileType: 'application/pdf',
          userId,
        },
        {
          id: 'file2',
          name: 'b.pdf',
          url: 'https://example.com/b.pdf',
          fileHash: 'hash2',
          size: 200,
          fileType: 'application/pdf',
          userId,
        },
      ]);
      const { id: kb1 } = await knowledgeBaseModel.create({ name: 'KB1' });
      const { id: kb2 } = await knowledgeBaseModel.create({ name: 'KB2' });
      await knowledgeBaseModel.addFilesToKnowledgeBase(kb1, ['file1']);
      await knowledgeBaseModel.addFilesToKnowledgeBase(kb2, ['file2']);
      const result = await knowledgeBaseModel.deleteAllWithFiles();
      const remaining = await serverDB.query.knowledgeBases.findMany({
        where: eq(knowledgeBases.userId, userId),
      });
      expect(remaining).toHaveLength(0);
      expect(
        await serverDB.query.files.findFirst({ where: eq(files.id, 'file1') }),
      ).toBeUndefined();
      expect(
        await serverDB.query.files.findFirst({ where: eq(files.id, 'file2') }),
      ).toBeUndefined();
      expect(result.deletedFiles.length).toBe(2);
    });

    it('should delete shared file when both KBs sharing it are deleted', async () => {
      await serverDB
        .insert(globalFiles)
        .values([
          {
            hashId: 'hash1',
            url: 'https://example.com/a.pdf',
            size: 100,
            fileType: 'application/pdf',
            creator: userId,
          },
        ]);
      await serverDB
        .insert(files)
        .values([
          {
            id: 'file1',
            name: 'a.pdf',
            url: 'https://example.com/a.pdf',
            fileHash: 'hash1',
            size: 100,
            fileType: 'application/pdf',
            userId,
          },
        ]);
      const { id: kb1 } = await knowledgeBaseModel.create({ name: 'KB1' });
      const { id: kb2 } = await knowledgeBaseModel.create({ name: 'KB2' });
      await knowledgeBaseModel.addFilesToKnowledgeBase(kb1, ['file1']);
      await knowledgeBaseModel.addFilesToKnowledgeBase(kb2, ['file1']);
      const result = await knowledgeBaseModel.deleteAllWithFiles();
      expect(
        await serverDB.query.files.findFirst({ where: eq(files.id, 'file1') }),
      ).toBeUndefined();
      expect(result.deletedFiles.length).toBe(1);
    });

    it('should not delete other users KBs or files', async () => {
      const anotherModel = new KnowledgeBaseModel(serverDB, 'user2');
      const { id: otherKb } = await anotherModel.create({ name: 'Other KB' });
      await knowledgeBaseModel.deleteAllWithFiles();
      expect(
        await serverDB.query.knowledgeBases.findFirst({ where: eq(knowledgeBases.id, otherKb) }),
      ).toBeDefined();
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
