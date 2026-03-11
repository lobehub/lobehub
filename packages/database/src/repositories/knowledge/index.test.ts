// @vitest-environment node
import { FilesTabs } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { NewDocument, NewFile } from '../../schemas/file';
import { documents, files } from '../../schemas/file';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';
import { KnowledgeRepo } from './index';

const userId = 'knowledge-test-user';
const otherUserId = 'other-knowledge-user';

let knowledgeRepo: KnowledgeRepo;

const serverDB: LobeChatDatabase = await getTestDB();

beforeEach(async () => {
  // Clean up
  await serverDB.delete(users);

  // Create test users
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  // Initialize repo
  knowledgeRepo = new KnowledgeRepo(serverDB, userId);
});

describe('KnowledgeRepo', () => {
  describe('query - Documents category filtering', () => {
    beforeEach(async () => {
      // Create test files
      const testFiles: NewFile[] = [
        {
          fileType: 'application/pdf',
          name: 'regular-pdf-file.pdf',
          size: 1024,
          url: 'file-pdf-url',
          userId,
        },
        {
          fileType: 'custom/other',
          name: 'custom-file.txt',
          size: 512,
          url: 'custom-file-url',
          userId,
        },
      ];

      await serverDB.insert(files).values(testFiles);

      // Create test documents
      const testDocuments: NewDocument[] = [
        // This should be EXCLUDED (sourceType='file')
        {
          content: 'PDF from file upload',
          fileType: 'application/pdf',
          filename: 'uploaded-pdf.pdf',
          source: 'upload-source',
          sourceType: 'file',
          totalCharCount: 100,
          totalLineCount: 10,
          userId,
        },
        // This should be EXCLUDED (fileType='custom/document')
        {
          content: 'Editor document',
          fileType: 'custom/document',
          filename: 'editor-doc.md',
          source: 'editor-source',
          sourceType: 'file',
          totalCharCount: 200,
          totalLineCount: 20,
          userId,
        },
        // This should be INCLUDED (application/pdf with sourceType='api')
        {
          content: 'PDF from API',
          fileType: 'application/pdf',
          filename: 'api-pdf.pdf',
          source: 'api-source',
          sourceType: 'api',
          totalCharCount: 300,
          totalLineCount: 30,
          userId,
        },
        // This should be INCLUDED (custom/other with sourceType='web')
        {
          content: 'Custom web document',
          fileType: 'custom/other',
          filename: 'web-doc.txt',
          source: 'web-source',
          sourceType: 'web',
          totalCharCount: 400,
          totalLineCount: 40,
          userId,
        },
      ];

      await serverDB.insert(documents).values(testDocuments);
    });

    it('should exclude documents with fileType="custom/document" from Documents category', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.Documents });

      // Should not include editor document (custom/document)
      const editorDoc = results.find((item) => item.name === 'editor-doc.md');
      expect(editorDoc).toBeUndefined();
    });

    it('should exclude documents with sourceType="file" from Documents category', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.Documents });

      // Should not include uploaded PDF document (sourceType='file')
      const uploadedPdf = results.find((item) => item.name === 'uploaded-pdf.pdf');
      expect(uploadedPdf).toBeUndefined();
    });

    it('should include documents with sourceType="api" in Documents category', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.Documents });

      // Should include API PDF (application/pdf with sourceType='api')
      const apiPdf = results.find((item) => item.name === 'api-pdf.pdf');
      expect(apiPdf).toBeDefined();
      expect(apiPdf?.sourceType).toBe('document');
      expect(apiPdf?.fileType).toBe('application/pdf');
    });

    it('should include documents with sourceType="web" in Documents category', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.Documents });

      // Should include web document (custom/other with sourceType='web')
      const webDoc = results.find((item) => item.name === 'web-doc.txt');
      expect(webDoc).toBeDefined();
      expect(webDoc?.sourceType).toBe('document');
      expect(webDoc?.fileType).toBe('custom/other');
    });

    it('should include files from files table in Documents category', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.Documents });

      // Should include regular files
      const regularFile = results.find((item) => item.name === 'regular-pdf-file.pdf');
      expect(regularFile).toBeDefined();
      expect(regularFile?.sourceType).toBe('file');
    });

    it('should exclude sourceType=file documents from All category', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.All });

      // All category should include files from files table + documents with sourceType != 'file'
      // 2 files + 2 documents (api-pdf and web-doc)
      // Excluded: uploaded-pdf and editor-doc both have sourceType='file'
      expect(results.length).toBe(4);

      // Should NOT include documents with sourceType='file' (globally excluded now)
      const editorDoc = results.find((item) => item.name === 'editor-doc.md');
      const uploadedPdf = results.find((item) => item.name === 'uploaded-pdf.pdf');
      expect(editorDoc).toBeUndefined();
      expect(uploadedPdf).toBeUndefined();

      // Should include documents with sourceType != 'file'
      const apiPdf = results.find((item) => item.name === 'api-pdf.pdf');
      const webDoc = results.find((item) => item.name === 'web-doc.txt');
      expect(apiPdf).toBeDefined();
      expect(webDoc).toBeDefined();

      // Should include files from files table
      const regularFile = results.find((item) => item.name === 'regular-pdf-file.pdf');
      expect(regularFile).toBeDefined();
    });

    it('should apply both filters together in Documents category', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.Documents });

      // Count documents with sourceType='document'
      const documentTypeItems = results.filter((item) => item.sourceType === 'document');

      // Should have exactly 2 documents (api-pdf and web-doc)
      // Excluded: uploaded-pdf (sourceType='file') and editor-doc (fileType='custom/document')
      expect(documentTypeItems).toHaveLength(2);

      const names = documentTypeItems.map((item) => item.name).sort();
      expect(names).toEqual(['api-pdf.pdf', 'web-doc.txt']);
    });
  });

  describe('query - user isolation', () => {
    beforeEach(async () => {
      // Create files for current user
      await serverDB.insert(files).values({
        fileType: 'application/pdf',
        name: 'user-file.pdf',
        size: 1024,
        url: 'user-file-url',
        userId,
      });

      // Create files for other user
      await serverDB.insert(files).values({
        fileType: 'application/pdf',
        name: 'other-user-file.pdf',
        size: 1024,
        url: 'other-file-url',
        userId: otherUserId,
      });

      // Create documents for current user
      await serverDB.insert(documents).values({
        content: 'User document',
        fileType: 'application/pdf',
        filename: 'user-doc.pdf',
        source: 'user-source',
        sourceType: 'api',
        totalCharCount: 100,
        totalLineCount: 10,
        userId,
      });

      // Create documents for other user
      await serverDB.insert(documents).values({
        content: 'Other user document',
        fileType: 'application/pdf',
        filename: 'other-doc.pdf',
        source: 'other-source',
        sourceType: 'api',
        totalCharCount: 100,
        totalLineCount: 10,
        userId: otherUserId,
      });
    });

    it('should only return current user items', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.All });

      // Should only have items from current user
      expect(results).toHaveLength(2);

      const names = results.map((item) => item.name).sort();
      expect(names).toEqual(['user-doc.pdf', 'user-file.pdf']);

      // Should not include other user's items
      const otherUserFile = results.find((item) => item.name === 'other-user-file.pdf');
      const otherUserDoc = results.find((item) => item.name === 'other-doc.pdf');

      expect(otherUserFile).toBeUndefined();
      expect(otherUserDoc).toBeUndefined();
    });
  });

  describe('query - search filtering', () => {
    beforeEach(async () => {
      await serverDB.insert(files).values([
        {
          fileType: 'application/pdf',
          name: 'report-2024.pdf',
          size: 1024,
          url: 'report-url',
          userId,
        },
        {
          fileType: 'application/pdf',
          name: 'invoice.pdf',
          size: 512,
          url: 'invoice-url',
          userId,
        },
      ]);

      await serverDB.insert(documents).values([
        {
          content: 'Annual report content',
          fileType: 'application/pdf',
          filename: 'annual-report.pdf',
          source: 'api-source',
          sourceType: 'api',
          title: 'Annual Report',
          totalCharCount: 1000,
          totalLineCount: 100,
          userId,
        },
        {
          content: 'Meeting notes',
          fileType: 'custom/other',
          filename: 'notes.txt',
          source: 'web-source',
          sourceType: 'web',
          title: 'Meeting Notes',
          totalCharCount: 500,
          totalLineCount: 50,
          userId,
        },
      ]);
    });

    it('should filter by search query in file names', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.All, q: 'report' });

      expect(results).toHaveLength(2);
      const names = results.map((item) => item.name).sort();
      expect(names).toEqual(['Annual Report', 'report-2024.pdf']);
    });

    it('should filter by search query in document titles', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.All, q: 'meeting' });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Meeting Notes');
    });
  });

  describe('query - category filters', () => {
    beforeEach(async () => {
      // Create files of different types
      await serverDB.insert(files).values([
        {
          id: 'image-file',
          fileType: 'image/png',
          name: 'photo.png',
          size: 1024,
          url: 'image-url',
          userId,
        },
        {
          id: 'video-file',
          fileType: 'video/mp4',
          name: 'video.mp4',
          size: 2048,
          url: 'video-url',
          userId,
        },
        {
          id: 'audio-file',
          fileType: 'audio/mp3',
          name: 'music.mp3',
          size: 512,
          url: 'audio-url',
          userId,
        },
        {
          id: 'html-file',
          fileType: 'text/html',
          name: 'page.html',
          size: 256,
          url: 'html-url',
          userId,
        },
      ]);
    });

    it('should filter by Images category', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.Images });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('photo.png');
      expect(results[0].fileType).toBe('image/png');
    });

    it('should filter by Videos category', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.Videos });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('video.mp4');
      expect(results[0].fileType).toBe('video/mp4');
    });

    it('should filter by Audios category', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.Audios });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('music.mp3');
      expect(results[0].fileType).toBe('audio/mp3');
    });

    it('should filter by Websites category', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.Websites });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('page.html');
      expect(results[0].fileType).toBe('text/html');
    });
  });

  describe('query - sorting', () => {
    beforeEach(async () => {
      await serverDB.insert(files).values([
        {
          id: 'file-a',
          fileType: 'application/pdf',
          name: 'a-file.pdf',
          size: 100,
          url: 'url-a',
          userId,
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-05T10:00:00Z'),
        },
        {
          id: 'file-b',
          fileType: 'application/pdf',
          name: 'b-file.pdf',
          size: 200,
          url: 'url-b',
          userId,
          createdAt: new Date('2024-01-02T10:00:00Z'),
          updatedAt: new Date('2024-01-03T10:00:00Z'),
        },
      ]);
    });

    it('should sort by name ascending', async () => {
      const results = await knowledgeRepo.query({
        category: FilesTabs.All,
        sorter: 'name',
        sortType: 'asc',
      });

      expect(results[0].name).toBe('a-file.pdf');
      expect(results[1].name).toBe('b-file.pdf');
    });

    it('should sort by name descending', async () => {
      const results = await knowledgeRepo.query({
        category: FilesTabs.All,
        sorter: 'name',
        sortType: 'desc',
      });

      expect(results[0].name).toBe('b-file.pdf');
      expect(results[1].name).toBe('a-file.pdf');
    });

    it('should sort by size ascending', async () => {
      const results = await knowledgeRepo.query({
        category: FilesTabs.All,
        sorter: 'size',
        sortType: 'asc',
      });

      expect(results[0].size).toBe(100);
      expect(results[1].size).toBe(200);
    });
  });

  describe('query - pagination', () => {
    beforeEach(async () => {
      // Create 5 files
      const testFiles = Array.from({ length: 5 }, (_, i) => ({
        id: `paginate-file-${i}`,
        fileType: 'application/pdf',
        name: `file-${i}.pdf`,
        size: 100 * (i + 1),
        url: `url-${i}`,
        userId,
        createdAt: new Date(`2024-01-0${i + 1}T10:00:00Z`),
      }));

      await serverDB.insert(files).values(testFiles);
    });

    it('should respect limit parameter', async () => {
      const results = await knowledgeRepo.query({ limit: 2 });

      expect(results).toHaveLength(2);
    });

    it('should respect offset parameter', async () => {
      const results = await knowledgeRepo.query({ limit: 2, offset: 2 });

      expect(results).toHaveLength(2);
    });
  });

  describe('queryRecent', () => {
    beforeEach(async () => {
      // Create files with different updated times
      await serverDB.insert(files).values([
        {
          id: 'recent-file-1',
          fileType: 'application/pdf',
          name: 'recent-1.pdf',
          size: 1024,
          url: 'url-1',
          userId,
          updatedAt: new Date('2024-01-03T10:00:00Z'),
        },
        {
          id: 'recent-file-2',
          fileType: 'application/pdf',
          name: 'recent-2.pdf',
          size: 1024,
          url: 'url-2',
          userId,
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'other-user-file',
          fileType: 'application/pdf',
          name: 'other-recent.pdf',
          size: 1024,
          url: 'url-other',
          userId: otherUserId,
          updatedAt: new Date('2024-01-05T10:00:00Z'),
        },
      ]);

      // Create documents
      await serverDB.insert(documents).values([
        {
          id: 'recent-doc-1',
          content: 'Recent document content',
          fileType: 'custom/other',
          filename: 'recent-doc.txt',
          source: 'api-source',
          sourceType: 'api',
          totalCharCount: 100,
          totalLineCount: 10,
          userId,
          updatedAt: new Date('2024-01-02T10:00:00Z'),
        },
      ]);
    });

    it('should return recent items ordered by updatedAt desc', async () => {
      const results = await knowledgeRepo.queryRecent(10);

      // Should return items for current user only, ordered by updatedAt desc
      expect(results).toHaveLength(3);
      expect(results[0].name).toBe('recent-1.pdf'); // Most recent
      expect(results[1].name).toBe('recent-doc.txt');
      expect(results[2].name).toBe('recent-2.pdf'); // Least recent
    });

    it('should respect limit parameter', async () => {
      const results = await knowledgeRepo.queryRecent(2);

      expect(results).toHaveLength(2);
    });

    it('should not return other users items', async () => {
      const results = await knowledgeRepo.queryRecent(10);

      const otherUserItem = results.find((item) => item.name === 'other-recent.pdf');
      expect(otherUserItem).toBeUndefined();
    });
  });

  describe('deleteItem', () => {
    beforeEach(async () => {
      await serverDB.insert(files).values({
        id: 'delete-file',
        fileType: 'application/pdf',
        name: 'to-delete.pdf',
        size: 1024,
        url: 'delete-url',
        userId,
      });

      await serverDB.insert(documents).values({
        id: 'delete-doc',
        content: 'Document to delete',
        fileType: 'custom/other',
        filename: 'to-delete-doc.txt',
        source: 'source',
        sourceType: 'api',
        totalCharCount: 100,
        totalLineCount: 10,
        userId,
      });
    });

    it('should delete a file by id', async () => {
      await knowledgeRepo.deleteItem('delete-file', 'file');

      // Verify file was deleted
      const result = await serverDB.query.files.findFirst({
        where: (f, { eq }) => eq(f.id, 'delete-file'),
      });
      expect(result).toBeUndefined();
    });

    it('should delete a document by id', async () => {
      await knowledgeRepo.deleteItem('delete-doc', 'document');

      // Verify document was deleted
      const result = await serverDB.query.documents.findFirst({
        where: (d, { eq }) => eq(d.id, 'delete-doc'),
      });
      expect(result).toBeUndefined();
    });
  });

  describe('deleteMany', () => {
    beforeEach(async () => {
      await serverDB.insert(files).values([
        {
          id: 'delete-many-file-1',
          fileType: 'application/pdf',
          name: 'delete-1.pdf',
          size: 1024,
          url: 'url-1',
          userId,
        },
        {
          id: 'delete-many-file-2',
          fileType: 'application/pdf',
          name: 'delete-2.pdf',
          size: 1024,
          url: 'url-2',
          userId,
        },
      ]);

      await serverDB.insert(documents).values([
        {
          id: 'delete-many-doc-1',
          content: 'Delete doc 1',
          fileType: 'custom/other',
          filename: 'delete-doc-1.txt',
          source: 'source',
          sourceType: 'api',
          totalCharCount: 100,
          totalLineCount: 10,
          userId,
        },
      ]);
    });

    it('should delete multiple items of mixed types', async () => {
      await knowledgeRepo.deleteMany([
        { id: 'delete-many-file-1', sourceType: 'file' },
        { id: 'delete-many-file-2', sourceType: 'file' },
        { id: 'delete-many-doc-1', sourceType: 'document' },
      ]);

      // Verify files were deleted
      const file1 = await serverDB.query.files.findFirst({
        where: (f, { eq }) => eq(f.id, 'delete-many-file-1'),
      });
      const file2 = await serverDB.query.files.findFirst({
        where: (f, { eq }) => eq(f.id, 'delete-many-file-2'),
      });
      const doc1 = await serverDB.query.documents.findFirst({
        where: (d, { eq }) => eq(d.id, 'delete-many-doc-1'),
      });

      expect(file1).toBeUndefined();
      expect(file2).toBeUndefined();
      expect(doc1).toBeUndefined();
    });

    it('should handle empty items array', async () => {
      // Should not throw
      await expect(knowledgeRepo.deleteMany([])).resolves.not.toThrow();
    });

    it('should delete only files when no documents provided', async () => {
      await knowledgeRepo.deleteMany([{ id: 'delete-many-file-1', sourceType: 'file' }]);

      // Verify only specified file was deleted
      const file1 = await serverDB.query.files.findFirst({
        where: (f, { eq }) => eq(f.id, 'delete-many-file-1'),
      });
      const file2 = await serverDB.query.files.findFirst({
        where: (f, { eq }) => eq(f.id, 'delete-many-file-2'),
      });

      expect(file1).toBeUndefined();
      expect(file2).toBeDefined();
    });
  });

  describe('findById', () => {
    beforeEach(async () => {
      await serverDB.insert(files).values({
        id: 'find-file',
        fileType: 'application/pdf',
        name: 'find-me.pdf',
        size: 1024,
        url: 'find-url',
        userId,
      });

      await serverDB.insert(documents).values({
        id: 'find-doc',
        content: 'Find this document',
        fileType: 'custom/other',
        filename: 'find-me-doc.txt',
        source: 'source',
        sourceType: 'api',
        totalCharCount: 100,
        totalLineCount: 10,
        userId,
      });
    });

    it('should find a file by id', async () => {
      const result = await knowledgeRepo.findById('find-file', 'file');

      expect(result).toBeDefined();
      expect(result?.name).toBe('find-me.pdf');
    });

    it('should find a document by id', async () => {
      const result = await knowledgeRepo.findById('find-doc', 'document');

      expect(result).toBeDefined();
      expect(result?.filename).toBe('find-me-doc.txt');
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
});
