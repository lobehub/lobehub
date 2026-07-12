// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { works, workVersions } from '../../../schemas';
import { AgentDocumentModel } from '../../agentDocuments';
import { WorkModel } from '..';
import {
  agentId,
  cleanupWorkTestData,
  expectDocumentSnapshot,
  expectDocumentSummaryItem,
  seedWorkTestData,
  serverDB,
  topicId,
  userId,
  userId2,
} from './_fixtures';

beforeEach(seedWorkTestData);
afterEach(cleanupWorkTestData);

describe('WorkModel · document', () => {
  it('registers a document work using the backing document id', async () => {
    const agentDocumentModel = new AgentDocumentModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const doc = await agentDocumentModel.create(agentId, 'research.md', 'Research body', {
      metadata: { description: 'Research notes' },
      title: 'Research Notes',
    });

    const work = await workModel.registerDocument({
      agentDocumentId: doc.id,
      agentId,
      documentId: doc.documentId,
      role: 'created',
      rootOperationId: 'op-doc-create',
      source: 'createDocument',
      sourceToolCallId: 'tool-call-doc-create',
      topicId,
      url: 'https://app.example.com/agent/agent-1/docs/doc-1',
    });

    expect(work).toBeDefined();
    expect(work).toMatchObject({
      resourceId: doc.documentId,
      resourceIdentifier: 'research.md',
      resourceType: 'document',
      type: 'document',
    });

    const versions = await workModel.listVersions(work!.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].snapshot).toMatchObject({
      document: {
        description: 'Research notes',
        id: doc.documentId,
        title: 'Research Notes',
        url: 'https://app.example.com/agent/agent-1/docs/doc-1',
      },
    });
    expect(versions[0]).toMatchObject({
      metadata: { agentDocumentId: doc.id },
      rootOperationId: 'op-doc-create',
      sourceToolCallId: 'tool-call-doc-create',
    });

    const byOperation = await workModel.listByRootOperation({ rootOperationId: 'op-doc-create' });
    expect(byOperation[0]).toMatchObject({
      document: expect.objectContaining({ id: doc.documentId, title: 'Research Notes' }),
      id: work?.id,
      type: 'document',
    });

    const summaries = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-doc-create'],
    });
    expect(summaries['op-doc-create']?.[0]).toMatchObject({
      document: expect.objectContaining({ description: 'Research notes', id: doc.documentId }),
      event: expect.objectContaining({
        metadata: { agentDocumentId: doc.id },
      }),
      id: work?.id,
      type: 'document',
    });
  });

  it('uses the document content prefix when document description is empty', async () => {
    const agentDocumentModel = new AgentDocumentModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const content = [
      'This document explains how Work cards should display a useful document excerpt.',
      'It keeps the product panel populated even when document metadata has no description.',
      'The extra sentence makes the value long enough to verify truncation.',
    ].join('\n\n');
    const normalizedContent = content.replaceAll(/\s+/g, ' ').trim();
    const expectedDescription = `${normalizedContent.slice(0, 120)}...`;
    const doc = await agentDocumentModel.create(agentId, 'empty-description.md', content, {
      title: 'No Description',
    });

    const work = await workModel.registerDocument({
      agentDocumentId: doc.id,
      agentId,
      documentId: doc.documentId,
      role: 'created',
      rootOperationId: 'op-doc-empty-description',
      source: 'createDocument',
      sourceToolCallId: 'tool-call-doc-empty-description',
      topicId,
    });

    const versions = await workModel.listVersions(work!.id);
    expect(expectDocumentSnapshot(versions[0].snapshot).description).toBe(expectedDescription);

    const byOperation = await workModel.listByRootOperation({
      rootOperationId: 'op-doc-empty-description',
    });
    expect(byOperation[0]).toMatchObject({
      document: expect.objectContaining({ description: expectedDescription }),
    });

    const summaries = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-doc-empty-description'],
    });
    const documentSummary = expectDocumentSummaryItem(summaries['op-doc-empty-description']?.[0]);
    expect(documentSummary.document.description).toBe(expectedDescription);

    const byConversation = await workModel.listByConversation({ topicId });
    expect(byConversation[0]).toMatchObject({
      document: expect.objectContaining({ description: expectedDescription }),
    });
  });

  it('keeps one document work row and appends versions for document edits', async () => {
    const agentDocumentModel = new AgentDocumentModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const doc = await agentDocumentModel.create(agentId, 'draft.md', 'Draft body', {
      title: 'Draft',
    });

    const first = await workModel.registerDocument({
      agentDocumentId: doc.id,
      agentId,
      documentId: doc.documentId,
      role: 'created',
      rootOperationId: 'op-doc-create',
      source: 'createDocument',
      sourceToolCallId: 'tool-call-doc-create',
      topicId,
    });

    await agentDocumentModel.rename(doc.id, 'Renamed Draft');

    const second = await workModel.registerDocument({
      agentDocumentId: doc.id,
      agentId,
      documentId: doc.documentId,
      role: 'updated',
      rootOperationId: 'op-doc-rename',
      source: 'renameDocument',
      sourceToolCallId: 'tool-call-doc-rename',
      topicId,
    });

    const replay = await workModel.registerDocument({
      agentDocumentId: doc.id,
      agentId,
      documentId: doc.documentId,
      role: 'updated',
      rootOperationId: 'op-doc-rename',
      source: 'renameDocument',
      sourceToolCallId: 'tool-call-doc-rename',
      topicId,
    });

    expect(second?.id).toBe(first?.id);
    expect(replay?.id).toBe(first?.id);

    const workRows = await serverDB
      .select()
      .from(works)
      .where(eq(works.resourceId, doc.documentId));
    expect(workRows).toHaveLength(1);

    const versions = await workModel.listVersions(first!.id);
    expect(versions.map((item) => item.version)).toEqual([2, 1]);
    expect(versions[0].snapshot).toMatchObject({
      document: { id: doc.documentId, title: 'Renamed Draft' },
    });
  });

  it('deletes document work and cascades versions when agent document is removed', async () => {
    const agentDocumentModel = new AgentDocumentModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    const doc = await agentDocumentModel.create(agentId, 'delete.md', 'Delete body', {
      title: 'Delete me',
    });

    const work = await workModel.registerDocument({
      agentDocumentId: doc.id,
      agentId,
      documentId: doc.documentId,
      role: 'created',
      source: 'createDocument',
      sourceToolCallId: 'tool-call-doc-delete',
    });

    await agentDocumentModel.delete(doc.id);
    await workModel.deleteDocumentWork({
      agentDocumentId: doc.id,
      agentId,
      documentId: doc.documentId,
    });

    const workRows = await serverDB.select().from(works).where(eq(works.id, work!.id));
    const versionRows = await serverDB
      .select()
      .from(workVersions)
      .where(eq(workVersions.workId, work!.id));

    expect(workRows).toHaveLength(0);
    expect(versionRows).toHaveLength(0);
  });

  it('does not let another user register someone else document work', async () => {
    const agentDocumentModel = new AgentDocumentModel(serverDB, userId);
    const otherWorkModel = new WorkModel(serverDB, userId2);
    const doc = await agentDocumentModel.create(agentId, 'private.md', 'Private body');

    const work = await otherWorkModel.registerDocument({
      agentDocumentId: doc.id,
      agentId,
      documentId: doc.documentId,
      role: 'created',
      source: 'createDocument',
      sourceToolCallId: 'tool-call-other-doc-user',
      topicId,
    });

    expect(work).toBeNull();
    const workRows = await serverDB.select().from(works);
    expect(workRows).toHaveLength(0);
  });
});
