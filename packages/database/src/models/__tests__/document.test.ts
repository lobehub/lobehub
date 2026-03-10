// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documents, files, users } from '../../schemas';
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
  await serverDB.delete(users);
  await serverDB.delete(files);
  await serverDB.delete(documents);
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
});
