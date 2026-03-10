// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documents, sessions, topicDocuments, topics, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentModel } from '../document';
import { TopicDocumentModel } from '../topicDocument';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'topic-document-model-test-user-id';
const userId2 = 'topic-document-model-test-user-id-2';
const sessionId = 'topic-document-session';
const topicId = 'topic-document-topic';
const topicId2 = 'topic-document-topic-2';

const topicDocumentModel = new TopicDocumentModel(serverDB, userId);
const topicDocumentModel2 = new TopicDocumentModel(serverDB, userId2);
const documentModel = new DocumentModel(serverDB, userId);
const documentModel2 = new DocumentModel(serverDB, userId2);

// Helper to create a test document
const createTestDocument = async (model: DocumentModel, title: string, fileType = 'markdown') => {
  return model.create({
    content: `Content for ${title}`,
    fileType,
    source: `notebook:${topicId}`,
    sourceType: 'api',
    title,
    totalCharCount: 100,
    totalLineCount: 5,
  });
};

describe('TopicDocumentModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);

    // Create test users, session and topics
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }, { id: userId2 }]);
      await tx.insert(sessions).values({ id: sessionId, userId });
      await tx.insert(topics).values([
        { id: topicId, sessionId, userId },
        { id: topicId2, sessionId, userId },
      ]);
    });
  });

  afterEach(async () => {
    await serverDB.delete(topicDocuments);
    await serverDB.delete(documents);
    await serverDB.delete(topics);
    await serverDB.delete(sessions);
    await serverDB.delete(users);
  });

  describe('associate', () => {
    it('should associate a document with a topic', async () => {
      const doc = await createTestDocument(documentModel, 'Test Document');

      const result = await topicDocumentModel.associate({
        documentId: doc.id,
        topicId,
      });

      expect(result.documentId).toBe(doc.id);
      expect(result.topicId).toBe(topicId);
    });

    it('should associate the same document with multiple topics', async () => {
      const doc = await createTestDocument(documentModel, 'Shared Document');

      await topicDocumentModel.associate({ documentId: doc.id, topicId });
      await topicDocumentModel.associate({ documentId: doc.id, topicId: topicId2 });

      const topicIds = await topicDocumentModel.findByDocumentId(doc.id);
      expect(topicIds).toHaveLength(2);
      expect(topicIds).toContain(topicId);
      expect(topicIds).toContain(topicId2);
    });

    it('should associate multiple documents with the same topic', async () => {
      const doc1 = await createTestDocument(documentModel, 'Document 1');
      const doc2 = await createTestDocument(documentModel, 'Document 2');

      await topicDocumentModel.associate({ documentId: doc1.id, topicId });
      await topicDocumentModel.associate({ documentId: doc2.id, topicId });

      const docs = await topicDocumentModel.findByTopicId(topicId);
      expect(docs).toHaveLength(2);
    });
  });

  describe('disassociate', () => {
    it('should remove association between document and topic', async () => {
      const doc = await createTestDocument(documentModel, 'Test Document');
      await topicDocumentModel.associate({ documentId: doc.id, topicId });

      await topicDocumentModel.disassociate(doc.id, topicId);

      const isStillAssociated = await topicDocumentModel.isAssociated(doc.id, topicId);
      expect(isStillAssociated).toBe(false);
    });

    it('should not affect other associations', async () => {
      const doc = await createTestDocument(documentModel, 'Shared Document');
      await topicDocumentModel.associate({ documentId: doc.id, topicId });
      await topicDocumentModel.associate({ documentId: doc.id, topicId: topicId2 });

      await topicDocumentModel.disassociate(doc.id, topicId);

      const isAssociatedWithTopic1 = await topicDocumentModel.isAssociated(doc.id, topicId);
      const isAssociatedWithTopic2 = await topicDocumentModel.isAssociated(doc.id, topicId2);

      expect(isAssociatedWithTopic1).toBe(false);
      expect(isAssociatedWithTopic2).toBe(true);
    });

    it('should not affect associations of other users', async () => {
      // Create document and topic for user2
      await serverDB.insert(topics).values({ id: 'user2-topic', sessionId, userId: userId2 });
      const doc2 = await documentModel2.create({
        content: 'User 2 content',
        fileType: 'markdown',
        source: 'notebook:user2-topic',
        sourceType: 'api',
        title: 'User 2 Doc',
        totalCharCount: 50,
        totalLineCount: 2,
      });
      await topicDocumentModel2.associate({ documentId: doc2.id, topicId: 'user2-topic' });

      // User 1 tries to disassociate user 2's document
      await topicDocumentModel.disassociate(doc2.id, 'user2-topic');

      // User 2's association should still exist
      const isStillAssociated = await topicDocumentModel2.isAssociated(doc2.id, 'user2-topic');
      expect(isStillAssociated).toBe(true);
    });
  });

  describe('findByTopicId', () => {
    it('should return all documents associated with a topic', async () => {
      const doc1 = await createTestDocument(documentModel, 'Document 1');
      const doc2 = await createTestDocument(documentModel, 'Document 2');

      await topicDocumentModel.associate({ documentId: doc1.id, topicId });
      await topicDocumentModel.associate({ documentId: doc2.id, topicId });

      const docs = await topicDocumentModel.findByTopicId(topicId);

      expect(docs).toHaveLength(2);
      expect(docs.map((d) => d.title)).toContain('Document 1');
      expect(docs.map((d) => d.title)).toContain('Document 2');
    });

    it('should return documents with associatedAt timestamp', async () => {
      const doc = await createTestDocument(documentModel, 'Test Document');
      await topicDocumentModel.associate({ documentId: doc.id, topicId });

      const docs = await topicDocumentModel.findByTopicId(topicId);

      expect(docs).toHaveLength(1);
      expect(docs[0].associatedAt).toBeInstanceOf(Date);
    });

    it('should filter documents by type', async () => {
      const markdownDoc = await createTestDocument(documentModel, 'Markdown Doc', 'markdown');
      const reportDoc = await createTestDocument(documentModel, 'Report Doc', 'report');

      await topicDocumentModel.associate({ documentId: markdownDoc.id, topicId });
      await topicDocumentModel.associate({ documentId: reportDoc.id, topicId });

      const markdownDocs = await topicDocumentModel.findByTopicId(topicId, { type: 'markdown' });
      const reportDocs = await topicDocumentModel.findByTopicId(topicId, { type: 'report' });

      expect(markdownDocs).toHaveLength(1);
      expect(markdownDocs[0].title).toBe('Markdown Doc');
      expect(reportDocs).toHaveLength(1);
      expect(reportDocs[0].title).toBe('Report Doc');
    });

    it('should return documents ordered by createdAt desc', async () => {
      const doc1 = await createTestDocument(documentModel, 'First Document');
      await new Promise((resolve) => setTimeout(resolve, 50));
      const doc2 = await createTestDocument(documentModel, 'Second Document');

      await topicDocumentModel.associate({ documentId: doc1.id, topicId });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await topicDocumentModel.associate({ documentId: doc2.id, topicId });

      const docs = await topicDocumentModel.findByTopicId(topicId);

      expect(docs).toHaveLength(2);
      // Most recently associated should be first
      expect(docs[0].title).toBe('Second Document');
      expect(docs[1].title).toBe('First Document');
    });

    it('should return empty array for topic with no documents', async () => {
      const docs = await topicDocumentModel.findByTopicId(topicId);
      expect(docs).toHaveLength(0);
    });

    it('should only return documents for the current user', async () => {
      const doc = await createTestDocument(documentModel, 'User 1 Doc');
      await topicDocumentModel.associate({ documentId: doc.id, topicId });

      // User 2 tries to find documents in user 1's topic
      const docsForUser2 = await topicDocumentModel2.findByTopicId(topicId);
      expect(docsForUser2).toHaveLength(0);
    });
  });

  describe('findByDocumentId', () => {
    it('should return all topic IDs associated with a document', async () => {
      const doc = await createTestDocument(documentModel, 'Shared Document');

      await topicDocumentModel.associate({ documentId: doc.id, topicId });
      await topicDocumentModel.associate({ documentId: doc.id, topicId: topicId2 });

      const topicIds = await topicDocumentModel.findByDocumentId(doc.id);

      expect(topicIds).toHaveLength(2);
      expect(topicIds).toContain(topicId);
      expect(topicIds).toContain(topicId2);
    });

    it('should return empty array for document with no associations', async () => {
      const doc = await createTestDocument(documentModel, 'Unassociated Document');

      const topicIds = await topicDocumentModel.findByDocumentId(doc.id);
      expect(topicIds).toHaveLength(0);
    });

    it('should only return associations for the current user', async () => {
      const doc = await createTestDocument(documentModel, 'User 1 Doc');
      await topicDocumentModel.associate({ documentId: doc.id, topicId });

      // User 2 tries to find associations
      const topicIdsForUser2 = await topicDocumentModel2.findByDocumentId(doc.id);
      expect(topicIdsForUser2).toHaveLength(0);
    });
  });

  describe('isAssociated', () => {
    it('should return true when document is associated with topic', async () => {
      const doc = await createTestDocument(documentModel, 'Test Document');
      await topicDocumentModel.associate({ documentId: doc.id, topicId });

      const isAssociated = await topicDocumentModel.isAssociated(doc.id, topicId);
      expect(isAssociated).toBe(true);
    });

    it('should return false when document is not associated with topic', async () => {
      const doc = await createTestDocument(documentModel, 'Test Document');

      const isAssociated = await topicDocumentModel.isAssociated(doc.id, topicId);
      expect(isAssociated).toBe(false);
    });

    it('should return false for non-existent document', async () => {
      const isAssociated = await topicDocumentModel.isAssociated('non-existent-doc', topicId);
      expect(isAssociated).toBe(false);
    });

    it('should return false for non-existent topic', async () => {
      const doc = await createTestDocument(documentModel, 'Test Document');
      await topicDocumentModel.associate({ documentId: doc.id, topicId });

      const isAssociated = await topicDocumentModel.isAssociated(doc.id, 'non-existent-topic');
      expect(isAssociated).toBe(false);
    });

    it('should respect user isolation', async () => {
      const doc = await createTestDocument(documentModel, 'User 1 Doc');
      await topicDocumentModel.associate({ documentId: doc.id, topicId });

      // User 2 checks if document is associated
      const isAssociatedForUser2 = await topicDocumentModel2.isAssociated(doc.id, topicId);
      expect(isAssociatedForUser2).toBe(false);
    });
  });

  describe('deleteByTopicId', () => {
    it('should remove all associations for a topic', async () => {
      const doc1 = await createTestDocument(documentModel, 'Document 1');
      const doc2 = await createTestDocument(documentModel, 'Document 2');

      await topicDocumentModel.associate({ documentId: doc1.id, topicId });
      await topicDocumentModel.associate({ documentId: doc2.id, topicId });

      await topicDocumentModel.deleteByTopicId(topicId);

      const docs = await topicDocumentModel.findByTopicId(topicId);
      expect(docs).toHaveLength(0);
    });

    it('should not affect associations in other topics', async () => {
      const doc = await createTestDocument(documentModel, 'Shared Document');

      await topicDocumentModel.associate({ documentId: doc.id, topicId });
      await topicDocumentModel.associate({ documentId: doc.id, topicId: topicId2 });

      await topicDocumentModel.deleteByTopicId(topicId);

      const isAssociatedWithTopic1 = await topicDocumentModel.isAssociated(doc.id, topicId);
      const isAssociatedWithTopic2 = await topicDocumentModel.isAssociated(doc.id, topicId2);

      expect(isAssociatedWithTopic1).toBe(false);
      expect(isAssociatedWithTopic2).toBe(true);
    });

    it('should not affect other users associations', async () => {
      // Create topic for user 2
      await serverDB.insert(topics).values({ id: 'user2-topic', sessionId, userId: userId2 });
      const doc2 = await documentModel2.create({
        content: 'User 2 content',
        fileType: 'markdown',
        source: 'notebook:user2-topic',
        sourceType: 'api',
        title: 'User 2 Doc',
        totalCharCount: 50,
        totalLineCount: 2,
      });
      await topicDocumentModel2.associate({ documentId: doc2.id, topicId: 'user2-topic' });

      // User 1 deletes their topic associations
      const doc1 = await createTestDocument(documentModel, 'User 1 Doc');
      await topicDocumentModel.associate({ documentId: doc1.id, topicId });
      await topicDocumentModel.deleteByTopicId(topicId);

      // User 2's associations should remain
      const isUser2Associated = await topicDocumentModel2.isAssociated(doc2.id, 'user2-topic');
      expect(isUser2Associated).toBe(true);
    });
  });

  describe('deleteByDocumentId', () => {
    it('should remove all associations for a document', async () => {
      const doc = await createTestDocument(documentModel, 'Shared Document');

      await topicDocumentModel.associate({ documentId: doc.id, topicId });
      await topicDocumentModel.associate({ documentId: doc.id, topicId: topicId2 });

      await topicDocumentModel.deleteByDocumentId(doc.id);

      const topicIds = await topicDocumentModel.findByDocumentId(doc.id);
      expect(topicIds).toHaveLength(0);
    });

    it('should not affect other documents associations', async () => {
      const doc1 = await createTestDocument(documentModel, 'Document 1');
      const doc2 = await createTestDocument(documentModel, 'Document 2');

      await topicDocumentModel.associate({ documentId: doc1.id, topicId });
      await topicDocumentModel.associate({ documentId: doc2.id, topicId });

      await topicDocumentModel.deleteByDocumentId(doc1.id);

      const isDoc1Associated = await topicDocumentModel.isAssociated(doc1.id, topicId);
      const isDoc2Associated = await topicDocumentModel.isAssociated(doc2.id, topicId);

      expect(isDoc1Associated).toBe(false);
      expect(isDoc2Associated).toBe(true);
    });

    it('should not affect other users associations', async () => {
      // Create document for user 2
      await serverDB.insert(topics).values({ id: 'user2-topic', sessionId, userId: userId2 });
      const doc2 = await documentModel2.create({
        content: 'User 2 content',
        fileType: 'markdown',
        source: 'notebook:user2-topic',
        sourceType: 'api',
        title: 'User 2 Doc',
        totalCharCount: 50,
        totalLineCount: 2,
      });
      await topicDocumentModel2.associate({ documentId: doc2.id, topicId: 'user2-topic' });

      // User 1 tries to delete associations for user 2's document
      await topicDocumentModel.deleteByDocumentId(doc2.id);

      // User 2's association should remain
      const isUser2Associated = await topicDocumentModel2.isAssociated(doc2.id, 'user2-topic');
      expect(isUser2Associated).toBe(true);
    });
  });
});
