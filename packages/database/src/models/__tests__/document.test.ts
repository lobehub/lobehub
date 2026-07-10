// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  DOCUMENT_FOLDER_TYPE,
  documentHistories,
  documents,
  files,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentModel } from '../document';
import { FileModel } from '../file';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'document-model-test-user-id';
const userId2 = 'document-model-test-user-id-2';
const documentModel = new DocumentModel(serverDB, userId);
const documentModel2 = new DocumentModel(serverDB, userId2);
const fileModel = new FileModel(serverDB, userId);
const fileModel2 = new FileModel(serverDB, userId2);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: userId2 }]);
});

afterEach(async () => {
  await serverDB.delete(files);
  await serverDB.delete(documentHistories);
  await serverDB.delete(documents);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

// Helper to create a minimal valid document
const createTestDocument = async (model: DocumentModel, fModel: FileModel, content: string) => {
  const { id: fileId } = await fModel.create({
    fileType: 'text/plain',
    name: 'test.txt',
    size: 100,
    url: 'https://example.com/test.txt',
  });

  // Fetch the file to get complete data
  const file = await fModel.findById(fileId);
  if (!file) throw new Error('File not found after creation');

  const { id } = await model.create({
    content,
    fileId: file.id,
    fileType: 'text/plain',
    source: file.url,
    sourceType: 'file',
    totalCharCount: content.length,
    totalLineCount: content.split('\n').length,
  });

  return { documentId: id, file };
};

describe('DocumentModel', () => {
  describe('findOrCreateFolder', () => {
    it('should create a new folder when none exists', async () => {
      const folder = await documentModel.findOrCreateFolder('bookmark');

      expect(folder).toBeDefined();
      expect(folder.fileType).toBe('custom/folder');
      expect(folder.filename).toBe('bookmark');
      expect(folder.title).toBe('bookmark');
      expect(folder.source).toBe('');
      expect(folder.sourceType).toBe('api');
      expect(folder.totalCharCount).toBe(0);
      expect(folder.content).toBe('');
    });

    it('should return existing folder on second call', async () => {
      const first = await documentModel.findOrCreateFolder('bookmark');
      const second = await documentModel.findOrCreateFolder('bookmark');

      expect(second.id).toBe(first.id);
    });

    it('should isolate folders by user', async () => {
      const folder1 = await documentModel.findOrCreateFolder('bookmark');
      const folder2 = await documentModel2.findOrCreateFolder('bookmark');

      expect(folder1.id).not.toBe(folder2.id);
    });

    it('should support parentId for nested folders', async () => {
      const parent = await documentModel.findOrCreateFolder('root');
      const child = await documentModel.findOrCreateFolder('sub', parent.id);

      expect(child.parentId).toBe(parent.id);
      expect(child.id).not.toBe(parent.id);
    });

    it('should distinguish folders with same name but different parentId', async () => {
      const topLevel = await documentModel.findOrCreateFolder('notes');
      const parent = await documentModel.findOrCreateFolder('root');
      const nested = await documentModel.findOrCreateFolder('notes', parent.id);

      expect(topLevel.id).not.toBe(nested.id);
    });
  });

  describe('create', () => {
    it('should create a new document', async () => {
      const { id: fileId } = await fileModel.create({
        fileType: 'text/plain',
        name: 'test.txt',
        size: 100,
        url: 'https://example.com/test.txt',
      });

      const file = await fileModel.findById(fileId);
      if (!file) throw new Error('File not found');

      const result = await documentModel.create({
        content: 'Test content',
        fileId: file.id,
        fileType: 'text/plain',
        source: file.url,
        sourceType: 'file',
        totalCharCount: 12,
        totalLineCount: 1,
      });

      expect(result).toBeDefined();
      expect(result.content).toBe('Test content');
      expect(result.fileId).toBe(file.id);
    });
  });

  describe('delete', () => {
    it('should delete a document', async () => {
      const { documentId } = await createTestDocument(documentModel, fileModel, 'Test content');

      await documentModel.delete(documentId);

      const deleted = await documentModel.findById(documentId);
      expect(deleted).toBeUndefined();
    });

    it('should not delete document belonging to another user', async () => {
      const { documentId } = await createTestDocument(documentModel, fileModel, 'Test content');

      // Try to delete with another user's model
      await documentModel2.delete(documentId);

      // Document should still exist
      const stillExists = await documentModel.findById(documentId);
      expect(stillExists).toBeDefined();
    });
  });

  describe('deleteAll', () => {
    it('should delete all documents for the user', async () => {
      await createTestDocument(documentModel, fileModel, 'First document');
      await createTestDocument(documentModel, fileModel, 'Second document');
      await createTestDocument(documentModel2, fileModel2, 'Other user document');

      await documentModel.deleteAll();

      const userDocs = await documentModel.query();
      const otherUserDocs = await documentModel2.query();

      expect(userDocs.items).toHaveLength(0);
      expect(userDocs.total).toBe(0);
      expect(otherUserDocs.items).toHaveLength(1);
      expect(otherUserDocs.total).toBe(1);
    });
  });

  describe('query', () => {
    it('should return all documents for the user', async () => {
      await createTestDocument(documentModel, fileModel, 'First document');
      await createTestDocument(documentModel, fileModel, 'Second document');

      const result = await documentModel.query();

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should exclude agent-owned documents unless sourceTypes explicitly requests them', async () => {
      await createTestDocument(documentModel, fileModel, 'Visible document');
      await documentModel.create({
        content: 'Agent document',
        fileType: 'agent/document',
        filename: 'agent-document',
        source: 'agent-document://agent-1/agent-document',
        sourceType: 'agent',
        totalCharCount: 14,
        totalLineCount: 1,
      });

      const defaultResult = await documentModel.query();

      expect(defaultResult.items).toHaveLength(1);
      expect(defaultResult.items[0].sourceType).not.toBe('agent');

      const agentResult = await documentModel.query({ sourceTypes: ['agent'] });

      expect(agentResult.items).toHaveLength(1);
      expect(agentResult.items[0].sourceType).toBe('agent');
    });

    it('should only return documents for the current user', async () => {
      await createTestDocument(documentModel, fileModel, 'User 1 document');
      await createTestDocument(documentModel2, fileModel2, 'User 2 document');

      const result = await documentModel.query();

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.items[0].content).toBe(null); // content is excluded in query
    });

    it('should filter documents by sourceTypes', async () => {
      // Create documents with different source types
      const { id: fileId1 } = await fileModel.create({
        fileType: 'text/plain',
        name: 'test1.txt',
        size: 100,
        url: 'https://example.com/test1.txt',
      });
      const file1 = await fileModel.findById(fileId1);
      if (!file1) throw new Error('File not found');

      const { id: fileId2 } = await fileModel.create({
        fileType: 'text/html',
        name: 'test2.html',
        size: 200,
        url: 'https://example.com/test2.html',
      });
      const file2 = await fileModel.findById(fileId2);
      if (!file2) throw new Error('File not found');

      const { id: fileId3 } = await fileModel.create({
        fileType: 'application/json',
        name: 'test3.json',
        size: 300,
        url: 'https://example.com/test3.json',
      });
      const file3 = await fileModel.findById(fileId3);
      if (!file3) throw new Error('File not found');

      await documentModel.create({
        content: 'File document',
        fileId: file1.id,
        fileType: 'text/plain',
        source: file1.url,
        sourceType: 'file',
        totalCharCount: 13,
        totalLineCount: 1,
      });

      await documentModel.create({
        content: 'Web document',
        fileId: file2.id,
        fileType: 'text/html',
        source: 'https://example.com/page',
        sourceType: 'web',
        totalCharCount: 12,
        totalLineCount: 1,
      });

      await documentModel.create({
        content: 'API document',
        fileId: file3.id,
        fileType: 'application/json',
        source: 'https://api.example.com/data',
        sourceType: 'api',
        totalCharCount: 12,
        totalLineCount: 1,
      });

      // Query with sourceTypes filter for 'file' only
      const fileResult = await documentModel.query({ sourceTypes: ['file'] });
      expect(fileResult.items).toHaveLength(1);
      expect(fileResult.total).toBe(1);
      expect(fileResult.items[0].sourceType).toBe('file');

      // Query with sourceTypes filter for 'web' and 'api'
      const webApiResult = await documentModel.query({ sourceTypes: ['web', 'api'] });
      expect(webApiResult.items).toHaveLength(2);
      expect(webApiResult.total).toBe(2);
      expect(
        webApiResult.items.every((d) => d.sourceType === 'web' || d.sourceType === 'api'),
      ).toBe(true);

      // Query without sourceTypes filter should return all
      const allResult = await documentModel.query();
      expect(allResult.items).toHaveLength(3);
      expect(allResult.total).toBe(3);
    });

    it('should filter documents by fileTypes', async () => {
      const { id: fileId1 } = await fileModel.create({
        fileType: 'text/plain',
        name: 'test1.txt',
        size: 100,
        url: 'https://example.com/test1.txt',
      });
      const file1 = await fileModel.findById(fileId1);
      if (!file1) throw new Error('File not found');

      const { id: fileId2 } = await fileModel.create({
        fileType: 'application/pdf',
        name: 'test2.pdf',
        size: 200,
        url: 'https://example.com/test2.pdf',
      });
      const file2 = await fileModel.findById(fileId2);
      if (!file2) throw new Error('File not found');

      await documentModel.create({
        content: 'Text document',
        fileId: file1.id,
        fileType: 'text/plain',
        source: file1.url,
        sourceType: 'file',
        totalCharCount: 13,
        totalLineCount: 1,
      });

      await documentModel.create({
        content: 'PDF document',
        fileId: file2.id,
        fileType: 'application/pdf',
        source: file2.url,
        sourceType: 'file',
        totalCharCount: 12,
        totalLineCount: 1,
      });

      // Filter by fileTypes
      const textResult = await documentModel.query({ fileTypes: ['text/plain'] });
      expect(textResult.items).toHaveLength(1);
      expect(textResult.total).toBe(1);

      // Without filter returns all
      const allResult = await documentModel.query();
      expect(allResult.items).toHaveLength(2);
    });

    it('should return documents ordered by updatedAt desc', async () => {
      const { documentId: doc1Id } = await createTestDocument(
        documentModel,
        fileModel,
        'First document',
      );
      const { documentId: doc2Id } = await createTestDocument(
        documentModel,
        fileModel,
        'Second document',
      );

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Update first document to make it more recent
      await documentModel.update(doc1Id, { content: 'Updated first document' });

      const result = await documentModel.query();

      expect(result.items[0].id).toBe(doc1Id);
      expect(result.items[1].id).toBe(doc2Id);
    });
  });

  describe('findById', () => {
    it('should find document by id', async () => {
      const { documentId } = await createTestDocument(documentModel, fileModel, 'Test content');

      const found = await documentModel.findById(documentId);

      expect(found).toBeDefined();
      expect(found?.id).toBe(documentId);
      expect(found?.content).toBe('Test content');
    });

    it('should return undefined for non-existent document', async () => {
      const found = await documentModel.findById('non-existent-id');

      expect(found).toBeUndefined();
    });

    it('should not find document belonging to another user', async () => {
      const { documentId } = await createTestDocument(documentModel, fileModel, 'Test content');

      const found = await documentModel2.findById(documentId);

      expect(found).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update a document', async () => {
      const { documentId } = await createTestDocument(documentModel, fileModel, 'Original content');

      await documentModel.update(documentId, {
        content: 'Updated content',
        totalCharCount: 15,
      });

      const updated = await documentModel.findById(documentId);

      expect(updated?.content).toBe('Updated content');
      expect(updated?.totalCharCount).toBe(15);
    });

    it('should not update document belonging to another user', async () => {
      const { documentId } = await createTestDocument(documentModel, fileModel, 'Original content');

      await documentModel2.update(documentId, { content: 'Hacked content' });

      const unchanged = await documentModel.findById(documentId);

      expect(unchanged?.content).toBe('Original content');
    });
  });

  describe('findBySlug', () => {
    it('should find document by slug', async () => {
      const { documentId } = await createTestDocument(
        documentModel,
        fileModel,
        'Test content for slug',
      );

      // Get the document to find its auto-generated slug
      const doc = await documentModel.findById(documentId);
      expect(doc).toBeDefined();
      expect(doc?.slug).toBeDefined();

      const found = await documentModel.findBySlug(doc!.slug!);
      expect(found).toBeDefined();
      expect(found?.id).toBe(documentId);
      expect(found?.content).toBe('Test content for slug');
    });

    it('should not find document from another user by slug', async () => {
      const { documentId } = await createTestDocument(documentModel, fileModel, 'Test content');

      const doc = await documentModel.findById(documentId);
      expect(doc?.slug).toBeDefined();

      // Try to find with another user's model
      const found = await documentModel2.findBySlug(doc!.slug!);
      expect(found).toBeUndefined();
    });

    it('should return undefined for non-existent slug', async () => {
      const found = await documentModel.findBySlug('non-existent-slug');
      expect(found).toBeUndefined();
    });
  });

  describe('findBySource', () => {
    // Crawl dedupe () leans on this finder — same URL + sourceType
    // must always return the existing row so repeated crawls update in place
    // instead of stacking new rows.
    it('finds a document by (source, sourceType)', async () => {
      const url = 'https://example.com/pull/1';
      const { id } = await documentModel.create({
        content: 'pr body',
        fileType: 'article',
        filename: 'pr',
        source: url,
        sourceType: 'web',
        title: 'PR title',
        totalCharCount: 7,
        totalLineCount: 1,
      });

      const found = await documentModel.findBySource(url, 'web');
      expect(found?.id).toBe(id);
    });

    it('is scoped to the current user', async () => {
      const url = 'https://example.com/shared-url';
      await documentModel.create({
        content: 'mine',
        fileType: 'article',
        filename: 'mine',
        source: url,
        sourceType: 'web',
        totalCharCount: 4,
        totalLineCount: 1,
      });

      const otherUserFound = await documentModel2.findBySource(url, 'web');
      expect(otherUserFound).toBeUndefined();
    });

    it('distinguishes by sourceType so an api-source URL is not returned as a web crawl', async () => {
      const url = 'https://example.com/cross-type';
      const { id: apiId } = await documentModel.create({
        content: 'api',
        fileType: 'article',
        filename: 'api',
        source: url,
        sourceType: 'api',
        totalCharCount: 3,
        totalLineCount: 1,
      });

      const webHit = await documentModel.findBySource(url, 'web');
      expect(webHit).toBeUndefined();

      const apiHit = await documentModel.findBySource(url, 'api');
      expect(apiHit?.id).toBe(apiId);
    });

    it('returns undefined when no matching document exists', async () => {
      const found = await documentModel.findBySource('https://example.com/missing', 'web');
      expect(found).toBeUndefined();
    });
  });

  describe('findByFileId', () => {
    it('should find document by fileId', async () => {
      const { documentId, file } = await createTestDocument(
        documentModel,
        fileModel,
        'Test content for file',
      );

      const found = await documentModel.findByFileId(file.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(documentId);
      expect(found?.fileId).toBe(file.id);
      expect(found?.content).toBe('Test content for file');
    });

    it('should not find document from another user', async () => {
      const { file } = await createTestDocument(documentModel, fileModel, 'Test content');

      // Try to find with another user's model
      const found = await documentModel2.findByFileId(file.id);
      expect(found).toBeUndefined();
    });

    it('should return undefined for non-existent fileId', async () => {
      const found = await documentModel.findByFileId('non-existent-file-id');
      expect(found).toBeUndefined();
    });

    it('should return the first document when multiple documents exist for same file', async () => {
      const { id: fileId } = await fileModel.create({
        fileType: 'text/plain',
        name: 'test.txt',
        size: 100,
        url: 'https://example.com/test.txt',
      });

      const file = await fileModel.findById(fileId);
      if (!file) throw new Error('File not found after creation');

      const { id: firstId } = await documentModel.create({
        content: 'First document',
        fileId: file.id,
        fileType: 'text/plain',
        source: file.url,
        sourceType: 'file',
        totalCharCount: 14,
        totalLineCount: 1,
      });

      await documentModel.create({
        content: 'Second document',
        fileId: file.id,
        fileType: 'text/plain',
        source: file.url,
        sourceType: 'file',
        totalCharCount: 15,
        totalLineCount: 1,
      });

      const found = await documentModel.findByFileId(file.id);
      expect(found).toBeDefined();
      // Should return the first created document
      expect(found?.id).toBe(firstId);
    });

    it('should handle different file types', async () => {
      const { id: pdfFileId } = await fileModel.create({
        fileType: 'application/pdf',
        name: 'document.pdf',
        size: 5000,
        url: 'https://example.com/document.pdf',
      });

      const pdfFile = await fileModel.findById(pdfFileId);
      if (!pdfFile) throw new Error('File not found after creation');

      await documentModel.create({
        content: 'PDF content',
        fileId: pdfFile.id,
        fileType: 'application/pdf',
        source: pdfFile.url,
        sourceType: 'file',
        totalCharCount: 11,
        totalLineCount: 1,
      });

      const found = await documentModel.findByFileId(pdfFile.id);
      expect(found).toBeDefined();
      expect(found?.fileType).toBe('application/pdf');
      expect(found?.content).toBe('PDF content');
    });
  });

  describe('countFileUsageInSubtree', () => {
    it('should return 0 when the root document does not exist', async () => {
      const total = await documentModel.countFileUsageInSubtree('non-existent-root');
      expect(total).toBe(0);
    });

    it('should sum sizes of files anchored to the document and its descendants', async () => {
      const root = await documentModel.findOrCreateFolder('root-folder');
      const child = await documentModel.findOrCreateFolder('child-folder', root.id);
      const grandchild = await documentModel.findOrCreateFolder('grandchild-folder', child.id);

      // Files anchored to documents in the subtree (parentId points at a document)
      await fileModel.create({
        fileType: 'text/plain',
        name: 'root-file.txt',
        parentId: root.id,
        size: 100,
        url: 'https://example.com/root-file.txt',
      });
      await fileModel.create({
        fileType: 'text/plain',
        name: 'child-file.txt',
        parentId: child.id,
        size: 250,
        url: 'https://example.com/child-file.txt',
      });
      await fileModel.create({
        fileType: 'text/plain',
        name: 'grandchild-file.txt',
        parentId: grandchild.id,
        size: 50,
        url: 'https://example.com/grandchild-file.txt',
      });

      const total = await documentModel.countFileUsageInSubtree(root.id);
      expect(total).toBe(400);
    });

    it('should return 0 when the subtree has no anchored files', async () => {
      const root = await documentModel.findOrCreateFolder('empty-folder');
      const total = await documentModel.countFileUsageInSubtree(root.id);
      expect(total).toBe(0);
    });

    it('should not count files owned by another user', async () => {
      const root = await documentModel.findOrCreateFolder('scoped-folder');
      // A file anchored to the doc but owned by user2 must be ignored.
      await fileModel2.create({
        fileType: 'text/plain',
        name: 'other-user-file.txt',
        parentId: root.id,
        size: 999,
        url: 'https://example.com/other-user-file.txt',
      });

      const total = await documentModel.countFileUsageInSubtree(root.id);
      expect(total).toBe(0);
    });
  });

  describe('transferTo', () => {
    it('should throw when the document does not exist', async () => {
      await expect(documentModel.transferTo('non-existent-doc', null, userId2)).rejects.toThrow(
        'Document not found',
      );
    });

    it('should transfer a document subtree to another user (personal scope)', async () => {
      const root = await documentModel.findOrCreateFolder('transfer-root');
      const child = await documentModel.findOrCreateFolder('transfer-child', root.id);
      const { id: anchoredFileId } = await fileModel.create({
        fileType: 'text/plain',
        name: 'anchored.txt',
        parentId: child.id,
        size: 100,
        url: 'https://example.com/anchored.txt',
      });

      const { documentIds } = await documentModel.transferTo(root.id, null, userId2);

      expect(documentIds).toHaveLength(2);
      expect(documentIds).toContain(root.id);
      expect(documentIds).toContain(child.id);

      // Original owner no longer sees the docs
      expect(await documentModel.findById(root.id)).toBeUndefined();
      // New owner sees them
      const movedRoot = await documentModel2.findById(root.id);
      expect(movedRoot).toBeDefined();
      expect(movedRoot?.userId).toBe(userId2);

      // The anchored file was re-homed to the new owner
      const movedFile = await fileModel2.findById(anchoredFileId);
      expect(movedFile).toBeDefined();
      expect(movedFile?.userId).toBe(userId2);
    });

    it('should resolve slug conflicts in the target scope when transferring', async () => {
      // Source doc with a known slug
      const source = await documentModel.create({
        content: 'source',
        fileType: 'article',
        filename: 'source',
        slug: 'shared-slug',
        source: 'https://example.com/source',
        sourceType: 'web',
        title: 'source',
        totalCharCount: 6,
        totalLineCount: 1,
      });

      // Target user already has a doc with the same slug
      await documentModel2.create({
        content: 'existing',
        fileType: 'article',
        filename: 'existing',
        slug: 'shared-slug',
        source: 'https://example.com/existing',
        sourceType: 'web',
        title: 'existing',
        totalCharCount: 8,
        totalLineCount: 1,
      });

      await documentModel.transferTo(source.id, null, userId2);

      const moved = await documentModel2.findById(source.id);
      expect(moved).toBeDefined();
      expect(moved?.userId).toBe(userId2);
      // Slug must have been bumped to avoid the unique conflict
      expect(moved?.slug).not.toBe('shared-slug');
      expect(moved?.slug).toBe('shared-slug-1');
    });
  });

  describe('copyToWorkspace', () => {
    const workspaceId = 'document-test-workspace-id';

    beforeEach(async () => {
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Test Workspace',
        primaryOwnerId: userId,
        slug: 'doc-test-ws',
      });
    });

    it('should throw when the document does not exist', async () => {
      await expect(
        documentModel.copyToWorkspace('non-existent-doc', workspaceId, userId),
      ).rejects.toThrow('Document not found');
    });

    it('should deep-clone a document subtree preserving topology', async () => {
      const root = await documentModel.create({
        content: 'root content',
        fileType: DOCUMENT_FOLDER_TYPE,
        filename: 'copy-root',
        source: '',
        sourceType: 'api',
        title: 'copy-root',
        totalCharCount: 12,
        totalLineCount: 1,
      });
      const child = await documentModel.create({
        content: 'child content',
        fileType: 'article',
        filename: 'copy-child',
        parentId: root.id,
        source: '',
        sourceType: 'api',
        title: 'copy-child',
        totalCharCount: 13,
        totalLineCount: 1,
      });

      const { rootId: newRootId } = await documentModel.copyToWorkspace(
        root.id,
        workspaceId,
        userId,
      );

      expect(newRootId).toBeDefined();
      expect(newRootId).not.toBe(root.id);

      // Cloned root exists in the workspace scope
      const wsModel = new DocumentModel(serverDB, userId, workspaceId);
      const clonedRoot = await wsModel.findById(newRootId);
      expect(clonedRoot).toBeDefined();
      expect(clonedRoot?.workspaceId).toBe(workspaceId);
      expect(clonedRoot?.content).toBe('root content');
      expect(clonedRoot?.metadata).toMatchObject({ duplicatedFrom: root.id });

      // Cloned child points at the cloned root, not the original
      const wsDocs = await serverDB.query.documents.findMany({
        where: eq(documents.workspaceId, workspaceId),
      });
      const clonedChild = wsDocs.find((d) => d.filename === 'copy-child');
      expect(clonedChild).toBeDefined();
      expect(clonedChild?.parentId).toBe(newRootId);
      expect(clonedChild?.metadata).toMatchObject({ duplicatedFrom: child.id });

      // Original docs untouched
      expect(await documentModel.findById(root.id)).toBeDefined();
    });

    it('should resolve slug conflicts in the target workspace when copying', async () => {
      // Pre-existing doc in the target workspace holding the slug
      const wsModel = new DocumentModel(serverDB, userId, workspaceId);
      await wsModel.create({
        content: 'existing',
        fileType: 'article',
        filename: 'existing',
        slug: 'copy-slug',
        source: '',
        sourceType: 'api',
        title: 'existing',
        totalCharCount: 8,
        totalLineCount: 1,
      });

      const source = await documentModel.create({
        content: 'source',
        fileType: 'article',
        filename: 'source',
        slug: 'copy-slug',
        source: '',
        sourceType: 'api',
        title: 'source',
        totalCharCount: 6,
        totalLineCount: 1,
      });

      const { rootId } = await documentModel.copyToWorkspace(source.id, workspaceId, userId);

      const cloned = await wsModel.findById(rootId);
      expect(cloned).toBeDefined();
      expect(cloned?.slug).not.toBe('copy-slug');
      expect(cloned?.slug).toBe('copy-slug-1');
    });
  });
});
