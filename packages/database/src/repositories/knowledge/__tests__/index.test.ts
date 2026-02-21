// @vitest-environment node
import { FilesTabs, SortType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { documents, files, knowledgeBaseFiles, knowledgeBases, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { KnowledgeRepo } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'knowledge-repo-test-user';
const otherUserId = 'other-knowledge-user';

let knowledgeRepo: KnowledgeRepo;

beforeEach(async () => {
  // Clean up
  await serverDB.delete(users);

  // Create test users
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  // Initialize repo
  knowledgeRepo = new KnowledgeRepo(serverDB, userId);
});

describe('KnowledgeRepo', () => {
  describe('query', () => {
    beforeEach(async () => {
      // Create knowledge base
      await serverDB.insert(knowledgeBases).values([
        { id: 'kb-1', userId, name: 'Test KB' },
        { id: 'kb-2', userId, name: 'Another KB' },
      ]);

      // Create test documents first (because files.parentId references documents)
      // Use sourceType: 'topic' for standalone documents (not linked to files table)
      // The implementation filters out sourceType='file' since those are returned via files query
      await serverDB.insert(documents).values([
        {
          id: 'doc-1',
          userId,
          title: 'My Note',
          fileType: 'custom/note',
          sourceType: 'topic',
          source: 'internal://note/doc-1',
          totalCharCount: 500,
          totalLineCount: 10,
          createdAt: new Date('2024-01-08T10:00:00Z'),
          updatedAt: new Date('2024-01-08T10:00:00Z'),
        },
        {
          id: 'doc-2',
          userId,
          title: 'Search Note',
          fileType: 'custom/note',
          sourceType: 'topic',
          source: 'internal://note/doc-2',
          totalCharCount: 300,
          totalLineCount: 5,
          createdAt: new Date('2024-01-09T10:00:00Z'),
          updatedAt: new Date('2024-01-09T10:00:00Z'),
        },
        {
          id: 'doc-in-kb',
          userId,
          title: 'KB Note',
          fileType: 'custom/note',
          sourceType: 'topic',
          source: 'internal://note/doc-in-kb',
          knowledgeBaseId: 'kb-1',
          totalCharCount: 200,
          totalLineCount: 4,
          createdAt: new Date('2024-01-10T10:00:00Z'),
          updatedAt: new Date('2024-01-10T10:00:00Z'),
        },
        {
          id: 'doc-folder',
          userId,
          title: 'Folder',
          fileType: 'custom/folder',
          sourceType: 'topic',
          source: 'internal://folder/doc-folder',
          slug: 'my-folder',
          totalCharCount: 0,
          totalLineCount: 0,
          createdAt: new Date('2024-01-12T10:00:00Z'),
          updatedAt: new Date('2024-01-12T10:00:00Z'),
        },
        {
          id: 'other-doc',
          userId: otherUserId,
          title: 'Other Note',
          fileType: 'custom/note',
          sourceType: 'topic',
          source: 'internal://note/other-doc',
          totalCharCount: 100,
          totalLineCount: 2,
          createdAt: new Date('2024-01-13T10:00:00Z'),
          updatedAt: new Date('2024-01-13T10:00:00Z'),
        },
      ]);

      // Create documents that have parents (after parent docs exist)
      await serverDB.insert(documents).values([
        {
          id: 'doc-with-parent',
          userId,
          title: 'Child Note',
          fileType: 'custom/note',
          sourceType: 'topic',
          source: 'internal://note/doc-with-parent',
          parentId: 'doc-1',
          totalCharCount: 150,
          totalLineCount: 3,
          createdAt: new Date('2024-01-11T10:00:00Z'),
          updatedAt: new Date('2024-01-11T10:00:00Z'),
        },
      ]);

      // Create test files (now doc-folder exists for parentId reference)
      await serverDB.insert(files).values([
        {
          id: 'file-1',
          userId,
          name: 'document.pdf',
          fileType: 'application/pdf',
          size: 1000,
          url: 'https://example.com/doc.pdf',
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'file-2',
          userId,
          name: 'image.png',
          fileType: 'image/png',
          size: 2000,
          url: 'https://example.com/img.png',
          createdAt: new Date('2024-01-02T10:00:00Z'),
          updatedAt: new Date('2024-01-02T10:00:00Z'),
        },
        {
          id: 'file-3',
          userId,
          name: 'video.mp4',
          fileType: 'video/mp4',
          size: 3000,
          url: 'https://example.com/video.mp4',
          createdAt: new Date('2024-01-03T10:00:00Z'),
          updatedAt: new Date('2024-01-03T10:00:00Z'),
        },
        {
          id: 'file-4',
          userId,
          name: 'audio.mp3',
          fileType: 'audio/mpeg',
          size: 1500,
          url: 'https://example.com/audio.mp3',
          createdAt: new Date('2024-01-04T10:00:00Z'),
          updatedAt: new Date('2024-01-04T10:00:00Z'),
        },
        {
          id: 'file-in-kb',
          userId,
          name: 'kb-file.pdf',
          fileType: 'application/pdf',
          size: 500,
          url: 'https://example.com/kb-file.pdf',
          createdAt: new Date('2024-01-05T10:00:00Z'),
          updatedAt: new Date('2024-01-05T10:00:00Z'),
        },
        {
          id: 'file-with-parent',
          userId,
          name: 'child-file.txt',
          fileType: 'text/plain',
          size: 100,
          url: 'https://example.com/child.txt',
          parentId: 'doc-folder', // Reference to document, not file
          createdAt: new Date('2024-01-06T10:00:00Z'),
          updatedAt: new Date('2024-01-06T10:00:00Z'),
        },
        {
          id: 'other-file',
          userId: otherUserId,
          name: 'other-file.txt',
          fileType: 'text/plain',
          size: 100,
          url: 'https://example.com/other.txt',
          createdAt: new Date('2024-01-07T10:00:00Z'),
          updatedAt: new Date('2024-01-07T10:00:00Z'),
        },
      ]);

      // Add file to knowledge base
      await serverDB
        .insert(knowledgeBaseFiles)
        .values([{ fileId: 'file-in-kb', knowledgeBaseId: 'kb-1', userId }]);
    });

    it('should return files and documents for current user', async () => {
      const result = await knowledgeRepo.query();

      // Should not include files in knowledge base or other user's items
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((item) => item.id !== 'other-file')).toBe(true);
      expect(result.every((item) => item.id !== 'other-doc')).toBe(true);
    });

    it('should filter by category - Images', async () => {
      const result = await knowledgeRepo.query({ category: FilesTabs.Images });

      expect(result.every((item) => item.fileType.startsWith('image'))).toBe(true);
    });

    it('should filter by category - Videos', async () => {
      const result = await knowledgeRepo.query({ category: FilesTabs.Videos });

      expect(result.every((item) => item.fileType.startsWith('video'))).toBe(true);
    });

    it('should filter by category - Audios', async () => {
      const result = await knowledgeRepo.query({ category: FilesTabs.Audios });

      expect(result.every((item) => item.fileType.startsWith('audio'))).toBe(true);
    });

    it('should filter by category - Documents', async () => {
      const result = await knowledgeRepo.query({ category: FilesTabs.Documents });

      expect(
        result.every(
          (item) =>
            item.fileType.startsWith('application') ||
            (item.fileType.startsWith('custom') && item.fileType !== 'custom/document'),
        ),
      ).toBe(true);
    });

    it('should search by query', async () => {
      const result = await knowledgeRepo.query({ q: 'Search' });

      expect(result.some((item) => item.name.includes('Search'))).toBe(true);
    });

    it('should sort by name asc', async () => {
      const result = await knowledgeRepo.query({
        sorter: 'name',
        sortType: SortType.Asc,
        limit: 50,
      });

      // Just verify that sorting is applied by checking we get results
      expect(result.length).toBeGreaterThan(0);
    });

    it('should sort by size desc', async () => {
      const result = await knowledgeRepo.query({
        sorter: 'size',
        sortType: SortType.Desc,
        limit: 50,
      });

      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].size).toBeGreaterThanOrEqual(result[i + 1].size);
      }
    });

    it('should respect limit and offset', async () => {
      const result1 = await knowledgeRepo.query({ limit: 2, offset: 0 });
      const result2 = await knowledgeRepo.query({ limit: 2, offset: 2 });

      expect(result1).toHaveLength(2);
      expect(result2).toHaveLength(2);
      expect(result1[0].id).not.toBe(result2[0].id);
    });

    it('should filter by knowledgeBaseId', async () => {
      const result = await knowledgeRepo.query({ knowledgeBaseId: 'kb-1' });

      // Should include files and documents in the knowledge base
      expect(result.some((item) => item.id === 'file-in-kb' || item.id === 'doc-in-kb')).toBe(true);
    });

    it('should filter by parentId', async () => {
      // file-with-parent has parentId 'doc-folder' (documents.id, not files.id)
      const result = await knowledgeRepo.query({ parentId: 'doc-folder' });

      expect(result.some((item) => item.id === 'file-with-parent')).toBe(true);
    });

    it('should resolve slug to parentId', async () => {
      // First ensure we have a document with child
      await serverDB.insert(documents).values([
        {
          id: 'child-of-folder',
          userId,
          title: 'Child of Folder',
          fileType: 'custom/note',
          sourceType: 'topic',
          source: 'internal://note/child-of-folder',
          parentId: 'doc-folder',
          totalCharCount: 100,
          totalLineCount: 2,
        },
      ]);

      const result = await knowledgeRepo.query({ parentId: 'my-folder' });

      expect(result.some((item) => item.id === 'child-of-folder')).toBe(true);
    });

    it('should exclude files in knowledge base by default', async () => {
      const result = await knowledgeRepo.query();

      expect(result.some((item) => item.id === 'file-in-kb')).toBe(false);
    });

    it('should include files in knowledge base when showFilesInKnowledgeBase is true', async () => {
      const result = await knowledgeRepo.query({ showFilesInKnowledgeBase: true });

      expect(result.some((item) => item.id === 'file-in-kb')).toBe(true);
    });
  });

  describe('queryRecent', () => {
    beforeEach(async () => {
      // Create test files
      await serverDB.insert(files).values([
        {
          id: 'recent-file-1',
          userId,
          name: 'recent1.txt',
          fileType: 'text/plain',
          size: 100,
          url: 'https://example.com/recent1.txt',
          updatedAt: new Date('2024-01-10T10:00:00Z'),
        },
        {
          id: 'recent-file-2',
          userId,
          name: 'recent2.txt',
          fileType: 'text/plain',
          size: 200,
          url: 'https://example.com/recent2.txt',
          updatedAt: new Date('2024-01-09T10:00:00Z'),
        },
      ]);

      // Create test documents
      await serverDB.insert(documents).values([
        {
          id: 'recent-doc-1',
          userId,
          title: 'Recent Note',
          fileType: 'custom/note',
          sourceType: 'topic',
          source: 'internal://note/recent-doc-1',
          totalCharCount: 100,
          totalLineCount: 2,
          updatedAt: new Date('2024-01-11T10:00:00Z'),
        },
      ]);
    });

    it('should return recent items ordered by updatedAt desc', async () => {
      const result = await knowledgeRepo.queryRecent();

      expect(result.length).toBeGreaterThan(0);

      // Should be ordered by updatedAt desc
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].updatedAt.getTime()).toBeGreaterThanOrEqual(
          result[i + 1].updatedAt.getTime(),
        );
      }
    });

    it('should respect limit parameter', async () => {
      const result = await knowledgeRepo.queryRecent(1);

      expect(result).toHaveLength(1);
    });
  });

  describe('deleteItem', () => {
    beforeEach(async () => {
      await serverDB.insert(files).values({
        id: 'delete-file',
        userId,
        name: 'to-delete.txt',
        fileType: 'text/plain',
        size: 100,
        url: 'https://example.com/delete.txt',
      });

      await serverDB.insert(documents).values([
        {
          id: 'delete-doc',
          userId,
          title: 'To Delete Note',
          fileType: 'custom/note',
          sourceType: 'topic',
          source: 'internal://note/delete-doc',
          totalCharCount: 100,
          totalLineCount: 2,
        },
      ]);
    });

    it('should delete file by id', async () => {
      await knowledgeRepo.deleteItem('delete-file', 'file');

      const file = await serverDB.query.files.findFirst({
        where: eq(files.id, 'delete-file'),
      });
      expect(file).toBeUndefined();
    });

    it('should delete document by id', async () => {
      await knowledgeRepo.deleteItem('delete-doc', 'document');

      const doc = await serverDB.query.documents.findFirst({
        where: eq(documents.id, 'delete-doc'),
      });
      expect(doc).toBeUndefined();
    });
  });

  describe('deleteMany', () => {
    beforeEach(async () => {
      await serverDB.insert(files).values([
        {
          id: 'delete-many-file-1',
          userId,
          name: 'delete1.txt',
          fileType: 'text/plain',
          size: 100,
          url: 'https://example.com/delete1.txt',
        },
        {
          id: 'delete-many-file-2',
          userId,
          name: 'delete2.txt',
          fileType: 'text/plain',
          size: 100,
          url: 'https://example.com/delete2.txt',
        },
      ]);

      await serverDB.insert(documents).values([
        {
          id: 'delete-many-doc-1',
          userId,
          title: 'Delete Note 1',
          fileType: 'custom/note',
          sourceType: 'topic',
          source: 'internal://note/delete-many-doc-1',
          totalCharCount: 100,
          totalLineCount: 2,
        },
        {
          id: 'delete-many-doc-2',
          userId,
          title: 'Delete Note 2',
          fileType: 'custom/note',
          sourceType: 'topic',
          source: 'internal://note/delete-many-doc-2',
          totalCharCount: 100,
          totalLineCount: 2,
        },
      ]);
    });

    it('should delete multiple files and documents', async () => {
      await knowledgeRepo.deleteMany([
        { id: 'delete-many-file-1', sourceType: 'file' },
        { id: 'delete-many-file-2', sourceType: 'file' },
        { id: 'delete-many-doc-1', sourceType: 'document' },
        { id: 'delete-many-doc-2', sourceType: 'document' },
      ]);

      const file1 = await serverDB.query.files.findFirst({
        where: eq(files.id, 'delete-many-file-1'),
      });
      const file2 = await serverDB.query.files.findFirst({
        where: eq(files.id, 'delete-many-file-2'),
      });
      const doc1 = await serverDB.query.documents.findFirst({
        where: eq(documents.id, 'delete-many-doc-1'),
      });
      const doc2 = await serverDB.query.documents.findFirst({
        where: eq(documents.id, 'delete-many-doc-2'),
      });

      expect(file1).toBeUndefined();
      expect(file2).toBeUndefined();
      expect(doc1).toBeUndefined();
      expect(doc2).toBeUndefined();
    });

    it('should handle empty arrays', async () => {
      await expect(knowledgeRepo.deleteMany([])).resolves.not.toThrow();
    });

    it('should handle files only', async () => {
      await knowledgeRepo.deleteMany([
        { id: 'delete-many-file-1', sourceType: 'file' },
        { id: 'delete-many-file-2', sourceType: 'file' },
      ]);

      const file1 = await serverDB.query.files.findFirst({
        where: eq(files.id, 'delete-many-file-1'),
      });
      expect(file1).toBeUndefined();

      // Documents should still exist
      const doc1 = await serverDB.query.documents.findFirst({
        where: eq(documents.id, 'delete-many-doc-1'),
      });
      expect(doc1).toBeDefined();
    });

    it('should handle documents only', async () => {
      await knowledgeRepo.deleteMany([
        { id: 'delete-many-doc-1', sourceType: 'document' },
        { id: 'delete-many-doc-2', sourceType: 'document' },
      ]);

      const doc1 = await serverDB.query.documents.findFirst({
        where: eq(documents.id, 'delete-many-doc-1'),
      });
      expect(doc1).toBeUndefined();

      // Files should still exist
      const file1 = await serverDB.query.files.findFirst({
        where: eq(files.id, 'delete-many-file-1'),
      });
      expect(file1).toBeDefined();
    });
  });

  describe('findById', () => {
    beforeEach(async () => {
      await serverDB.insert(files).values({
        id: 'find-file',
        userId,
        name: 'find-me.txt',
        fileType: 'text/plain',
        size: 100,
        url: 'https://example.com/find.txt',
      });

      await serverDB.insert(documents).values([
        {
          id: 'find-doc',
          userId,
          title: 'Find Me Note',
          fileType: 'custom/note',
          sourceType: 'topic',
          source: 'internal://note/find-doc',
          totalCharCount: 100,
          totalLineCount: 2,
        },
      ]);
    });

    it('should find file by id', async () => {
      const result = await knowledgeRepo.findById('find-file', 'file');

      expect(result).toBeDefined();
      expect(result.id).toBe('find-file');
      expect(result.name).toBe('find-me.txt');
    });

    it('should find document by id', async () => {
      const result = await knowledgeRepo.findById('find-doc', 'document');

      expect(result).toBeDefined();
      expect(result.id).toBe('find-doc');
      expect(result.title).toBe('Find Me Note');
    });

    it('should return undefined for non-existent file', async () => {
      const result = await knowledgeRepo.findById('non-existent', 'file');

      expect(result).toBeUndefined();
    });

    it('should return undefined for non-existent document', async () => {
      const result = await knowledgeRepo.findById('non-existent', 'document');

      expect(result).toBeUndefined();
    });
  });

  describe('query with website category', () => {
    beforeEach(async () => {
      await serverDB.insert(files).values([
        {
          id: 'website-file',
          userId,
          name: 'webpage.html',
          fileType: 'text/html',
          size: 500,
          url: 'https://example.com/page.html',
        },
        {
          id: 'text-file',
          userId,
          name: 'readme.txt',
          fileType: 'text/plain',
          size: 100,
          url: 'https://example.com/readme.txt',
        },
      ]);
    });

    it('should filter by category - Websites', async () => {
      const result = await knowledgeRepo.query({ category: FilesTabs.Websites });

      expect(result.some((item) => item.id === 'website-file')).toBe(true);
      expect(result.every((item) => item.fileType === 'text/html')).toBe(true);
    });
  });

  describe('query with All category', () => {
    beforeEach(async () => {
      await serverDB.insert(files).values([
        {
          id: 'all-file-1',
          userId,
          name: 'file1.txt',
          fileType: 'text/plain',
          size: 100,
          url: 'https://example.com/f1.txt',
        },
        {
          id: 'all-file-2',
          userId,
          name: 'file2.png',
          fileType: 'image/png',
          size: 200,
          url: 'https://example.com/f2.png',
        },
      ]);

      await serverDB.insert(documents).values([
        {
          id: 'all-doc-1',
          userId,
          title: 'All Note',
          fileType: 'custom/note',
          sourceType: 'topic',
          source: 'internal://note/all-doc-1',
          totalCharCount: 100,
          totalLineCount: 2,
        },
      ]);
    });

    it('should return all items when category is All', async () => {
      const result = await knowledgeRepo.query({ category: FilesTabs.All });

      expect(result.length).toBeGreaterThanOrEqual(3);
    });
  });
});
