// @vitest-environment node
import { FileSource, FilesTabs, ResourceSourceFilter } from '@lobechat/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import type { NewDocument, NewFile } from '../../schemas/file';
import { documents, files, knowledgeBaseFiles, knowledgeBases } from '../../schemas/file';
import { chunks, embeddings } from '../../schemas/rag';
import { fileChunks } from '../../schemas/relations';
import { users } from '../../schemas/user';
import { workspaces } from '../../schemas/workspace';
import type { LobeChatDatabase } from '../../type';
import { KnowledgeRepo } from './index';

const userId = 'knowledge-test-user';
const otherUserId = 'other-knowledge-user';
const deleteDocChunkId = '11111111-1111-4111-8111-111111111111';
const deleteManyDocChunkId = '22222222-2222-4222-8222-222222222222';
const deleteFolderFileChunkId = '33333333-3333-4333-8333-333333333333';
const deleteFolderDocChunkId = '44444444-4444-4444-8444-444444444444';
const deleteNestedFolderFileChunkId = '55555555-5555-4555-8555-555555555555';

let knowledgeRepo: KnowledgeRepo;
const testEmbedding = Array.from({ length: 1024 }, () => 0.1);

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

    it('should exclude document-table rows from Documents category (files only)', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.Documents });

      // Documents means uploaded document FILES; derived document rows stay out
      expect(results.find((item) => item.name === 'api-pdf.pdf')).toBeUndefined();
      expect(results.find((item) => item.name === 'web-doc.txt')).toBeUndefined();
      expect(results.every((item) => item.sourceType === 'file')).toBe(true);
    });

    it('should surface custom/* document rows under the Pages category', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.Pages });

      // custom/other derived doc belongs to Pages
      const webDoc = results.find((item) => item.name === 'web-doc.txt');
      expect(webDoc).toBeDefined();
      expect(webDoc?.sourceType).toBe('document');
      // uploaded files never surface under Pages
      expect(results.every((item) => item.sourceType === 'document')).toBe(true);
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

    it('should keep the Documents category free of document-table rows', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.Documents });

      const documentTypeItems = results.filter((item) => item.sourceType === 'document');
      expect(documentTypeItems).toHaveLength(0);

      // the uploaded pdf file from the files table is still there
      expect(results.find((item) => item.name === 'regular-pdf-file.pdf')).toBeDefined();
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

  describe('query - workspace isolation', () => {
    const workspaceId = 'knowledge-workspace';

    beforeEach(async () => {
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Knowledge Workspace',
        primaryOwnerId: userId,
        slug: workspaceId,
      });

      await serverDB.insert(files).values([
        {
          fileType: 'application/pdf',
          name: 'workspace-owner-file.pdf',
          size: 1024,
          url: 'workspace-owner-file-url',
          userId,
          workspaceId,
        },
        {
          fileType: 'application/pdf',
          name: 'viewer-personal-file.pdf',
          size: 1024,
          url: 'viewer-personal-file-url',
          userId: otherUserId,
        },
      ]);

      await serverDB.insert(documents).values([
        {
          content: 'Workspace owner document',
          fileType: 'application/pdf',
          filename: 'workspace-owner-doc.pdf',
          source: 'workspace-owner-source',
          sourceType: 'api',
          totalCharCount: 100,
          totalLineCount: 10,
          userId,
          workspaceId,
        },
        {
          content: 'Viewer personal document',
          fileType: 'application/pdf',
          filename: 'viewer-personal-doc.pdf',
          source: 'viewer-personal-source',
          sourceType: 'api',
          totalCharCount: 100,
          totalLineCount: 10,
          userId: otherUserId,
        },
      ]);
    });

    it('should return workspace items regardless of the creator user', async () => {
      const workspaceRepo = new KnowledgeRepo(serverDB, otherUserId, workspaceId);

      const results = await workspaceRepo.query({ category: FilesTabs.All });

      const names = results.map((item) => item.name).sort();
      expect(names).toEqual(['workspace-owner-doc.pdf', 'workspace-owner-file.pdf']);
    });

    it('should restrict workspace query results to the requested creator', async () => {
      const workspaceRepo = new KnowledgeRepo(serverDB, otherUserId, workspaceId);

      const ownerRows = await workspaceRepo.query({
        category: FilesTabs.All,
        creatorUserId: userId,
      });
      const callerRows = await workspaceRepo.query({
        category: FilesTabs.All,
        creatorUserId: otherUserId,
      });

      expect(ownerRows.map((item) => item.name).sort()).toEqual([
        'workspace-owner-doc.pdf',
        'workspace-owner-file.pdf',
      ]);
      expect(callerRows).toEqual([]);
    });

    it('should not return workspace items in personal mode', async () => {
      const results = await knowledgeRepo.query({ category: FilesTabs.All });

      const names = results.map((item) => item.name).sort();
      expect(names).not.toContain('workspace-owner-doc.pdf');
      expect(names).not.toContain('workspace-owner-file.pdf');
    });
  });

  describe('query - workspace visibility', () => {
    const workspaceId = 'knowledge-visibility-workspace';

    beforeEach(async () => {
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Visibility Workspace',
        primaryOwnerId: userId,
        slug: workspaceId,
      });

      await serverDB.insert(documents).values([
        {
          content: 'Public workspace document',
          fileType: 'application/pdf',
          filename: 'public-doc.pdf',
          source: 'public-source',
          sourceType: 'api',
          totalCharCount: 100,
          totalLineCount: 10,
          userId,
          visibility: 'public',
          workspaceId,
        },
        {
          content: 'Caller private document',
          fileType: 'application/pdf',
          filename: 'caller-private-doc.pdf',
          source: 'caller-private-source',
          sourceType: 'api',
          totalCharCount: 100,
          totalLineCount: 10,
          userId,
          visibility: 'private',
          workspaceId,
        },
        {
          content: 'Other member private document',
          fileType: 'application/pdf',
          filename: 'other-private-doc.pdf',
          source: 'other-private-source',
          sourceType: 'api',
          totalCharCount: 100,
          totalLineCount: 10,
          userId: otherUserId,
          visibility: 'private',
          workspaceId,
        },
      ]);
    });

    it('should hide other members private documents in All view', async () => {
      const repo = new KnowledgeRepo(serverDB, userId, workspaceId);

      const names = (await repo.query({ category: FilesTabs.All })).map((item) => item.name).sort();

      expect(names).toEqual(['caller-private-doc.pdf', 'public-doc.pdf']);
      expect(names).not.toContain('other-private-doc.pdf');
    });

    it('should only return caller-owned private documents when visibility=private', async () => {
      const repo = new KnowledgeRepo(serverDB, userId, workspaceId);

      const names = (await repo.query({ category: FilesTabs.All, visibility: 'private' })).map(
        (item) => item.name,
      );

      expect(names).toEqual(['caller-private-doc.pdf']);
    });

    it('should hide other members private documents in queryRecent', async () => {
      const repo = new KnowledgeRepo(serverDB, userId, workspaceId);

      const names = (await repo.queryRecent(10)).map((item) => item.name).sort();

      expect(names).toContain('caller-private-doc.pdf');
      expect(names).toContain('public-doc.pdf');
      expect(names).not.toContain('other-private-doc.pdf');
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

    it('should still return pages when newer files would fill the limit', async () => {
      // The page kind has to be filtered in SQL: filtering a truncated
      // recent-everything list dropped every page as soon as the newest rows
      // were all files, emptying the resource home "recent pages" section.
      await serverDB.insert(files).values(
        Array.from({ length: 5 }, (_, index) => ({
          id: `newer-file-${index}`,
          fileType: 'application/pdf',
          name: `newer-${index}.pdf`,
          size: 1024,
          url: `newer-url-${index}`,
          userId,
          updatedAt: new Date('2024-02-01T10:00:00Z'),
        })),
      );

      const results = await knowledgeRepo.queryRecent(3, 'page');

      expect(results.map((item) => item.name)).toEqual(['recent-doc.txt']);
    });

    it('should exclude folders from the page kind', async () => {
      await serverDB.insert(documents).values({
        id: 'recent-folder',
        fileType: 'custom/folder',
        filename: 'recent folder',
        source: 'api-source',
        sourceType: 'api',
        title: 'recent folder',
        totalCharCount: 0,
        totalLineCount: 0,
        updatedAt: new Date('2024-01-04T10:00:00Z'),
        userId,
      });

      const results = await knowledgeRepo.queryRecent(10, 'page');

      expect(results.some((item) => item.id === 'recent-folder')).toBe(false);
      expect(results.map((item) => item.name)).toEqual(['recent-doc.txt']);
    });

    it('should exclude derived page rows from the file kind', async () => {
      await serverDB.insert(files).values({
        id: 'derived-page-file',
        fileType: 'custom/document',
        name: 'a page',
        size: 0,
        url: 'url-page',
        userId,
        updatedAt: new Date('2024-01-04T10:00:00Z'),
      });

      const results = await knowledgeRepo.queryRecent(10, 'file');

      expect(results.some((item) => item.id === 'derived-page-file')).toBe(false);
      expect(results.map((item) => item.name)).toEqual(['recent-1.pdf', 'recent-2.pdf']);
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

      await serverDB.insert(files).values({
        id: 'delete-doc-file',
        fileType: 'application/pdf',
        name: 'delete-doc-file.pdf',
        size: 2048,
        url: 'delete-doc-file-url',
        userId,
      });

      await serverDB.insert(documents).values([
        {
          id: 'delete-doc',
          content: 'Document to delete',
          fileType: 'custom/other',
          filename: 'to-delete-doc.txt',
          source: 'source',
          sourceType: 'api',
          totalCharCount: 100,
          totalLineCount: 10,
          userId,
        },
        {
          id: 'delete-folder',
          content: '',
          fileType: 'custom/folder',
          filename: 'delete-folder',
          source: 'source',
          sourceType: 'api',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
        },
      ]);
      await serverDB.insert(files).values([
        {
          id: 'delete-folder-file',
          fileType: 'application/pdf',
          name: 'delete-folder-file.pdf',
          parentId: 'delete-folder',
          size: 1024,
          url: 'delete-folder-file-url',
          userId,
        },
        {
          id: 'delete-folder-doc-file',
          fileType: 'application/pdf',
          name: 'delete-folder-doc-file.pdf',
          size: 1024,
          url: 'delete-folder-doc-file-url',
          userId,
        },
      ]);
      await serverDB.insert(documents).values([
        {
          id: 'delete-doc-with-file',
          content: 'Document with mirrored file',
          fileId: 'delete-doc-file',
          fileType: 'application/pdf',
          filename: 'delete-doc-file.pdf',
          source: 'source',
          sourceType: 'api',
          totalCharCount: 120,
          totalLineCount: 12,
          userId,
        },
        {
          id: 'delete-folder-doc',
          content: 'Folder child document',
          fileId: 'delete-folder-doc-file',
          fileType: 'application/pdf',
          filename: 'delete-folder-doc-file.pdf',
          parentId: 'delete-folder',
          source: 'source',
          sourceType: 'api',
          totalCharCount: 80,
          totalLineCount: 8,
          userId,
        },
        {
          id: 'delete-folder-child',
          content: '',
          fileType: 'custom/folder',
          filename: 'delete-folder-child',
          parentId: 'delete-folder',
          source: 'source',
          sourceType: 'api',
          totalCharCount: 0,
          totalLineCount: 0,
          userId,
        },
      ]);
      await serverDB.insert(files).values({
        id: 'delete-folder-child-file',
        fileType: 'application/pdf',
        name: 'delete-folder-child-file.pdf',
        parentId: 'delete-folder-child',
        size: 1024,
        url: 'delete-folder-child-file-url',
        userId,
      });

      await serverDB.insert(chunks).values({
        id: deleteDocChunkId,
        text: 'chunk for document file',
        userId,
      });
      await serverDB.insert(fileChunks).values({
        chunkId: deleteDocChunkId,
        fileId: 'delete-doc-file',
        userId,
      });
      await serverDB.insert(embeddings).values({
        chunkId: deleteDocChunkId,
        embeddings: testEmbedding,
        model: 'test-model',
        userId,
      });
      await serverDB.insert(chunks).values([
        {
          id: deleteFolderFileChunkId,
          text: 'chunk for folder file',
          userId,
        },
        {
          id: deleteFolderDocChunkId,
          text: 'chunk for folder mirrored file',
          userId,
        },
        {
          id: deleteNestedFolderFileChunkId,
          text: 'chunk for nested folder file',
          userId,
        },
      ]);
      await serverDB.insert(fileChunks).values([
        {
          chunkId: deleteFolderFileChunkId,
          fileId: 'delete-folder-file',
          userId,
        },
        {
          chunkId: deleteFolderDocChunkId,
          fileId: 'delete-folder-doc-file',
          userId,
        },
        {
          chunkId: deleteNestedFolderFileChunkId,
          fileId: 'delete-folder-child-file',
          userId,
        },
      ]);
      await serverDB.insert(embeddings).values([
        {
          chunkId: deleteFolderFileChunkId,
          embeddings: testEmbedding,
          model: 'test-model',
          userId,
        },
        {
          chunkId: deleteFolderDocChunkId,
          embeddings: testEmbedding,
          model: 'test-model',
          userId,
        },
        {
          chunkId: deleteNestedFolderFileChunkId,
          embeddings: testEmbedding,
          model: 'test-model',
          userId,
        },
      ]);
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

    it('should delete mirrored file data when deleting a file-backed document', async () => {
      await knowledgeRepo.deleteItem('delete-doc-with-file', 'document');

      const document = await serverDB.query.documents.findFirst({
        where: (d, { eq }) => eq(d.id, 'delete-doc-with-file'),
      });
      const file = await serverDB.query.files.findFirst({
        where: (f, { eq }) => eq(f.id, 'delete-doc-file'),
      });
      const chunk = await serverDB.query.chunks.findFirst({
        where: (c, { eq }) => eq(c.id, deleteDocChunkId),
      });
      const embedding = await serverDB.query.embeddings.findFirst({
        where: (e, { eq }) => eq(e.chunkId, deleteDocChunkId),
      });

      expect(document).toBeUndefined();
      expect(file).toBeUndefined();
      expect(chunk).toBeUndefined();
      expect(embedding).toBeUndefined();
    });

    it('should recursively delete child documents, files and vectors when deleting a folder', async () => {
      await knowledgeRepo.deleteItem('delete-folder', 'document');

      const folder = await serverDB.query.documents.findFirst({
        where: (d, { eq }) => eq(d.id, 'delete-folder'),
      });
      const childDoc = await serverDB.query.documents.findFirst({
        where: (d, { eq }) => eq(d.id, 'delete-folder-doc'),
      });
      const childFolder = await serverDB.query.documents.findFirst({
        where: (d, { eq }) => eq(d.id, 'delete-folder-child'),
      });
      const folderFile = await serverDB.query.files.findFirst({
        where: (f, { eq }) => eq(f.id, 'delete-folder-file'),
      });
      const childDocFile = await serverDB.query.files.findFirst({
        where: (f, { eq }) => eq(f.id, 'delete-folder-doc-file'),
      });
      const nestedFolderFile = await serverDB.query.files.findFirst({
        where: (f, { eq }) => eq(f.id, 'delete-folder-child-file'),
      });
      const folderFileChunk = await serverDB.query.chunks.findFirst({
        where: (c, { eq }) => eq(c.id, deleteFolderFileChunkId),
      });
      const childDocChunk = await serverDB.query.chunks.findFirst({
        where: (c, { eq }) => eq(c.id, deleteFolderDocChunkId),
      });
      const nestedFolderFileChunk = await serverDB.query.chunks.findFirst({
        where: (c, { eq }) => eq(c.id, deleteNestedFolderFileChunkId),
      });
      const folderFileEmbedding = await serverDB.query.embeddings.findFirst({
        where: (e, { eq }) => eq(e.chunkId, deleteFolderFileChunkId),
      });
      const childDocEmbedding = await serverDB.query.embeddings.findFirst({
        where: (e, { eq }) => eq(e.chunkId, deleteFolderDocChunkId),
      });
      const nestedFolderFileEmbedding = await serverDB.query.embeddings.findFirst({
        where: (e, { eq }) => eq(e.chunkId, deleteNestedFolderFileChunkId),
      });

      expect(folder).toBeUndefined();
      expect(childDoc).toBeUndefined();
      expect(childFolder).toBeUndefined();
      expect(folderFile).toBeUndefined();
      expect(childDocFile).toBeUndefined();
      expect(nestedFolderFile).toBeUndefined();
      expect(folderFileChunk).toBeUndefined();
      expect(childDocChunk).toBeUndefined();
      expect(nestedFolderFileChunk).toBeUndefined();
      expect(folderFileEmbedding).toBeUndefined();
      expect(childDocEmbedding).toBeUndefined();
      expect(nestedFolderFileEmbedding).toBeUndefined();
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
        {
          id: 'delete-many-doc-file-1',
          fileType: 'application/pdf',
          name: 'delete-many-doc-file-1.pdf',
          size: 1024,
          url: 'delete-many-doc-file-1-url',
          userId,
        },
      ]);

      await serverDB.insert(documents).values([
        {
          id: 'delete-many-doc-1',
          content: 'Delete doc 1',
          fileId: 'delete-many-doc-file-1',
          fileType: 'custom/other',
          filename: 'delete-doc-1.txt',
          source: 'source',
          sourceType: 'api',
          totalCharCount: 100,
          totalLineCount: 10,
          userId,
        },
      ]);
      await serverDB.insert(chunks).values({
        id: deleteManyDocChunkId,
        text: 'delete many chunk',
        userId,
      });
      await serverDB.insert(fileChunks).values({
        chunkId: deleteManyDocChunkId,
        fileId: 'delete-many-doc-file-1',
        userId,
      });
      await serverDB.insert(embeddings).values({
        chunkId: deleteManyDocChunkId,
        embeddings: testEmbedding,
        model: 'test-model',
        userId,
      });
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
      const mirroredFile = await serverDB.query.files.findFirst({
        where: (f, { eq }) => eq(f.id, 'delete-many-doc-file-1'),
      });
      const chunk = await serverDB.query.chunks.findFirst({
        where: (c, { eq }) => eq(c.id, deleteManyDocChunkId),
      });
      const embedding = await serverDB.query.embeddings.findFirst({
        where: (e, { eq }) => eq(e.chunkId, deleteManyDocChunkId),
      });

      expect(file1).toBeUndefined();
      expect(file2).toBeUndefined();
      expect(doc1).toBeUndefined();
      expect(mirroredFile).toBeUndefined();
      expect(chunk).toBeUndefined();
      expect(embedding).toBeUndefined();
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

  describe('query - knowledge base scoping', () => {
    beforeEach(async () => {
      await serverDB.insert(knowledgeBases).values({ id: 'kb-1', name: 'KB One', userId });

      await serverDB.insert(files).values([
        {
          id: 'kb-file',
          fileType: 'application/pdf',
          name: 'in-kb.pdf',
          size: 100,
          url: 'kb-file-url',
          userId,
        },
        {
          id: 'loose-file',
          fileType: 'application/pdf',
          name: 'outside-kb.pdf',
          size: 100,
          url: 'loose-file-url',
          userId,
        },
      ]);
      await serverDB
        .insert(knowledgeBaseFiles)
        .values([{ fileId: 'kb-file', knowledgeBaseId: 'kb-1', userId }]);

      await serverDB.insert(documents).values([
        // standalone note inside the KB — the document arm owns this row
        {
          id: 'kb-note',
          content: 'note',
          fileType: 'custom/other',
          filename: 'kb-note.txt',
          knowledgeBaseId: 'kb-1',
          source: 'note-source',
          sourceType: 'api',
          totalCharCount: 10,
          totalLineCount: 1,
          userId,
        },
        // note outside any KB
        {
          id: 'loose-note',
          content: 'note',
          fileType: 'custom/other',
          filename: 'loose-note.txt',
          source: 'note-source',
          sourceType: 'api',
          totalCharCount: 10,
          totalLineCount: 1,
          userId,
        },
      ]);
    });

    it('should return only the files and standalone notes of the requested knowledge base', async () => {
      const results = await knowledgeRepo.query({ knowledgeBaseId: 'kb-1' });

      expect(results.map((item) => item.id).sort()).toEqual(['kb-file', 'kb-note']);
    });

    it('should exclude knowledge-base files from the default listing', async () => {
      const results = await knowledgeRepo.query({ showFilesInKnowledgeBase: false });

      const ids = results.map((item) => item.id);
      expect(ids).toContain('loose-file');
      expect(ids).not.toContain('kb-file');
    });

    it('should include knowledge-base files when asked to', async () => {
      const results = await knowledgeRepo.query({ showFilesInKnowledgeBase: true });

      expect(results.map((item) => item.id)).toContain('kb-file');
    });
  });

  describe('query - parent scoping', () => {
    beforeEach(async () => {
      await serverDB.insert(documents).values({
        id: 'folder-1',
        content: null,
        fileType: 'custom/folder',
        filename: 'folder',
        source: 'folder-source',
        sourceType: 'api',
        totalCharCount: 0,
        totalLineCount: 0,
        userId,
      });

      await serverDB.insert(files).values([
        {
          id: 'child-file',
          fileType: 'application/pdf',
          name: 'child.pdf',
          parentId: 'folder-1',
          size: 100,
          url: 'child-url',
          userId,
        },
        {
          id: 'root-file',
          fileType: 'application/pdf',
          name: 'root.pdf',
          size: 100,
          url: 'root-url',
          userId,
        },
      ]);
    });

    it('should return only children of the requested parent', async () => {
      const results = await knowledgeRepo.query({ parentId: 'folder-1' });

      expect(results.map((item) => item.id)).toEqual(['child-file']);
    });

    it('should return only root-level rows when parentId is null', async () => {
      const results = await knowledgeRepo.query({ parentId: null });

      const ids = results.map((item) => item.id);
      expect(ids).toContain('root-file');
      expect(ids).toContain('folder-1');
      expect(ids).not.toContain('child-file');
    });
  });

  describe('acceptance evidence hiding', () => {
    beforeEach(async () => {
      await serverDB.insert(files).values([
        {
          id: 'library-file',
          fileType: 'text/plain',
          name: 'notes.txt',
          size: 100,
          url: 'library-url',
          userId,
        },
        {
          id: 'evidence-file',
          fileType: 'text/plain',
          name: 'payload-execution.txt',
          size: 100,
          source: FileSource.Acceptance,
          url: 'evidence-url',
          userId,
        },
        {
          id: 'generated-file',
          fileType: 'image/png',
          name: 'generated.png',
          size: 100,
          source: FileSource.ImageGeneration,
          url: 'generated-url',
          userId,
        },
      ]);
    });

    it('should hide acceptance evidence from the file list', async () => {
      const result = await knowledgeRepo.query({ category: FilesTabs.All });

      const ids = result.map((item) => item.fileId);
      expect(ids).toContain('library-file');
      expect(ids).toContain('generated-file');
      expect(ids).not.toContain('evidence-file');
    });

    it('should hide acceptance evidence from recent items', async () => {
      const result = await knowledgeRepo.queryRecent(50, 'file');

      expect(result.map((item) => item.fileId)).not.toContain('evidence-file');
    });

    it('should still resolve acceptance evidence by id', async () => {
      const result = await knowledgeRepo.findById('evidence-file', 'file');

      expect(result?.name).toBe('payload-execution.txt');
    });
  });

  describe('query - source filtering', () => {
    beforeEach(async () => {
      await serverDB.insert(files).values([
        {
          id: 'uploaded-image',
          fileType: 'image/png',
          name: 'screenshot.png',
          size: 100,
          url: 'uploaded-url',
          userId,
        },
        {
          id: 'pasted-image',
          fileType: 'image/png',
          name: 'pasted.png',
          size: 100,
          source: FileSource.PageEditor,
          url: 'pasted-url',
          userId,
        },
        {
          id: 'generated-image',
          fileType: 'image/png',
          name: 'generated.png',
          size: 100,
          source: FileSource.ImageGeneration,
          url: 'generated-url',
          userId,
        },
        {
          id: 'evidence-image',
          fileType: 'image/png',
          name: 'evidence.png',
          size: 100,
          source: FileSource.Acceptance,
          url: 'evidence-url',
          userId,
        },
      ]);
    });

    const queryImageIds = async (sourceFilter?: ResourceSourceFilter) => {
      const result = await knowledgeRepo.query({ category: FilesTabs.Images, sourceFilter });

      return result.map((item) => item.fileId);
    };

    it('should keep the historical pool when the filter is all', async () => {
      const ids = await queryImageIds(ResourceSourceFilter.All);

      expect(ids).toContain('uploaded-image');
      expect(ids).toContain('pasted-image');
      expect(ids).toContain('generated-image');
      expect(ids).not.toContain('evidence-image');
    });

    it('should return only model output when the filter is generated', async () => {
      const ids = await queryImageIds(ResourceSourceFilter.Generated);

      expect(ids).toEqual(['generated-image']);
    });

    it('should treat page-editor images as uploads and exclude generated output', async () => {
      const ids = await queryImageIds(ResourceSourceFilter.Uploaded);

      expect(ids).toContain('uploaded-image');
      expect(ids).toContain('pasted-image');
      expect(ids).not.toContain('generated-image');
      expect(ids).not.toContain('evidence-image');
    });

    it('should surface otherwise-hidden evidence when the filter is acceptance', async () => {
      const ids = await queryImageIds(ResourceSourceFilter.Acceptance);

      expect(ids).toEqual(['evidence-image']);
    });

    it('should drop documents from the union once the filter narrows', async () => {
      await serverDB.insert(documents).values({
        content: 'note body',
        fileType: 'custom/document',
        id: 'source-filter-note',
        source: 'note-source',
        sourceType: 'api',
        title: 'a note',
        totalCharCount: 9,
        totalLineCount: 1,
        userId,
      } as NewDocument);

      const all = await knowledgeRepo.query({ sourceFilter: ResourceSourceFilter.All });
      const generated = await knowledgeRepo.query({ sourceFilter: ResourceSourceFilter.Generated });

      expect(all.map((item) => item.id)).toContain('source-filter-note');
      expect(generated.map((item) => item.id)).not.toContain('source-filter-note');
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
