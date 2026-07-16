// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { documents, works, workspaces, workVersions } from '../../../schemas';
import { AgentDocumentModel } from '../../agentDocuments';
import { DocumentModel } from '../../document';
import { WorkModel } from '..';
import {
  agentId,
  cleanupWorkTestData,
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
      changeType: 'created',
      rootOperationId: 'op-doc-create',
      toolName: 'createDocument',
      toolCallId: 'tool-call-doc-create',
      toolIdentifier: 'lobe-agent-documents',
      topicId,
    });

    expect(work).toBeDefined();
    // Work keeps stable resource identity plus the current card projection.
    expect(work).toMatchObject({
      description: 'Research notes',
      resourceId: doc.documentId,
      resourceType: 'document',
      toolIdentifier: 'lobe-agent-documents',
      title: 'Research Notes',
      type: 'document',
      visibility: 'public',
    });

    const versions = await workModel.listVersions(work!.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      content: null,
      description: 'Research notes',
      identifier: 'research.md',
      metadata: { agentDocumentId: doc.id },
      rootOperationId: 'op-doc-create',
      toolCallId: 'tool-call-doc-create',
      title: 'Research Notes',
    });

    const byOperation = await workModel.listByRootOperation({ rootOperationId: 'op-doc-create' });
    expect(byOperation[0]).toMatchObject({
      description: 'Research notes',
      id: work?.id,
      identifier: 'research.md',
      title: 'Research Notes',
      type: 'document',
    });

    const summaries = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-doc-create'],
    });
    expect(summaries['op-doc-create']?.[0]).toMatchObject({
      description: 'Research notes',
      event: expect.objectContaining({
        metadata: { agentDocumentId: doc.id },
      }),
      id: work?.id,
      identifier: 'research.md',
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
      changeType: 'created',
      rootOperationId: 'op-doc-empty-description',
      toolName: 'createDocument',
      toolIdentifier: 'lobe-agent-documents',
      toolCallId: 'tool-call-doc-empty-description',
      topicId,
    });

    expect(work?.description).toBe(expectedDescription);

    const byOperation = await workModel.listByRootOperation({
      rootOperationId: 'op-doc-empty-description',
    });
    expect(byOperation[0]).toMatchObject({ description: expectedDescription });

    const summaries = await workModel.listSummariesByRootOperations({
      rootOperationIds: ['op-doc-empty-description'],
    });
    const documentSummary = expectDocumentSummaryItem(summaries['op-doc-empty-description']?.[0]);
    expect(documentSummary.description).toBe(expectedDescription);

    const byConversation = await workModel.listByConversation({ topicId });
    expect(byConversation[0]).toMatchObject({ description: expectedDescription });
  });

  it('truncates an oversized explicit description before writing the works row', async () => {
    const agentDocumentModel = new AgentDocumentModel(serverDB, userId);
    const workModel = new WorkModel(serverDB, userId);
    // Simulate a multi-KB description that must never be copied verbatim into the
    // card-preview `description` column.
    const longDescription = 'A'.repeat(5000);
    const expectedDescription = `${'A'.repeat(120)}...`;
    const doc = await agentDocumentModel.create(agentId, 'long-description.md', 'Body', {
      metadata: { description: 'Persisted description' },
      title: 'Long Description',
    });

    const work = await workModel.registerDocument({
      agentDocumentId: doc.id,
      agentId,
      description: longDescription,
      documentId: doc.documentId,
      changeType: 'created',
      rootOperationId: 'op-doc-long-description',
      toolName: 'createDocument',
      toolIdentifier: 'lobe-agent-documents',
      toolCallId: 'tool-call-doc-long-description',
      topicId,
    });

    const versions = await workModel.listVersions(work!.id);
    expect(versions).toHaveLength(1);
    expect(work?.description).toBe(expectedDescription);
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
      changeType: 'created',
      rootOperationId: 'op-doc-create',
      toolName: 'createDocument',
      toolIdentifier: 'lobe-agent-documents',
      toolCallId: 'tool-call-doc-create',
      topicId,
    });

    await agentDocumentModel.rename(doc.id, 'Renamed Draft');

    const second = await workModel.registerDocument({
      agentDocumentId: doc.id,
      agentId,
      documentId: doc.documentId,
      changeType: 'updated',
      rootOperationId: 'op-doc-rename',
      toolName: 'renameDocument',
      toolIdentifier: 'lobe-agent-documents',
      toolCallId: 'tool-call-doc-rename',
      topicId,
    });

    const replay = await workModel.registerDocument({
      agentDocumentId: doc.id,
      agentId,
      documentId: doc.documentId,
      changeType: 'updated',
      rootOperationId: 'op-doc-rename',
      toolName: 'renameDocument',
      toolIdentifier: 'lobe-agent-documents',
      toolCallId: 'tool-call-doc-rename',
      topicId,
    });

    expect(second?.id).toBe(first?.id);
    expect(replay?.id).toBe(first?.id);
    expect(replay?.updatedAt).toEqual(second?.updatedAt);

    const workRows = await serverDB
      .select()
      .from(works)
      .where(eq(works.resourceId, doc.documentId));
    expect(workRows).toHaveLength(1);

    const versions = await workModel.listVersions(first!.id);
    expect(versions.map((item) => item.version)).toEqual([2, 1]);
    expect(versions[0].title).toBe('Renamed Draft');
    expect(versions[1].title).toBe('Draft');
    // The current title cache follows the selected version.
    expect(second?.title).toBe('Renamed Draft');
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
      changeType: 'created',
      toolName: 'createDocument',
      toolIdentifier: 'lobe-agent-documents',
      toolCallId: 'tool-call-doc-delete',
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
      changeType: 'created',
      toolName: 'createDocument',
      toolIdentifier: 'lobe-agent-documents',
      toolCallId: 'tool-call-other-doc-user',
      topicId,
    });

    expect(work).toBeNull();
    const workRows = await serverDB.select().from(works);
    expect(workRows).toHaveLength(0);
  });
});

describe('WorkModel · workspace document visibility', () => {
  const workspaceId = 'work-test-doc-workspace-id';

  const seedWorkspace = async () => {
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Work Test Workspace',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
  };

  const registerWorkspaceDocument = async (visibility: 'private' | 'public') => {
    const ownerDocuments = new AgentDocumentModel(serverDB, userId, workspaceId);
    const ownerWorks = new WorkModel(serverDB, userId, workspaceId);

    const doc = await ownerDocuments.create(agentId, 'shared.md', 'Shared body', {
      metadata: { description: 'Shared description' },
      title: 'Shared doc',
    });
    // `documents.visibility` is NOT NULL default 'public'; flip it directly to
    // exercise the private branch of the guard.
    if (visibility === 'private') {
      await serverDB
        .update(documents)
        .set({ visibility: 'private' })
        .where(eq(documents.id, doc.documentId));
    }

    const work = await ownerWorks.registerDocument({
      agentDocumentId: doc.id,
      agentId,
      documentId: doc.documentId,
      changeType: 'created',
      rootOperationId: 'op-doc-visibility',
      toolName: 'createDocument',
      toolIdentifier: 'lobe-agent-documents',
      toolCallId: 'tool-call-doc-visibility',
      topicId,
    });

    return { doc, work };
  };

  it('hides another member private-document Work but keeps it for the registrant', async () => {
    await seedWorkspace();
    const ownerWorks = new WorkModel(serverDB, userId, workspaceId);
    const memberWorks = new WorkModel(serverDB, userId2, workspaceId);

    const { work } = await registerWorkspaceDocument('private');

    // The registrant keeps full access on every list path.
    expect(await ownerWorks.listByConversation({ topicId })).toHaveLength(1);

    // Another workspace member cannot see the private document's Work.
    expect(await memberWorks.listByConversation({ topicId })).toHaveLength(0);
    expect((await memberWorks.listByWorkspace({})).items).toHaveLength(0);
    expect(await memberWorks.listVersions(work!.id)).toHaveLength(0);
  });

  it('keeps a public-document Work visible to other members', async () => {
    await seedWorkspace();
    const ownerDocuments = new DocumentModel(serverDB, userId, workspaceId);
    const memberWorks = new WorkModel(serverDB, userId2, workspaceId);

    const { doc } = await registerWorkspaceDocument('public');

    const memberView = await memberWorks.listByConversation({ topicId });
    expect(memberView).toHaveLength(1);
    expect(memberView[0]).toMatchObject({ title: 'Shared doc', type: 'document' });

    await ownerDocuments.setVisibility(doc.documentId, 'private');

    const [mirrored] = await serverDB
      .select({ visibility: works.visibility })
      .from(works)
      .where(eq(works.resourceId, doc.documentId));
    expect(mirrored.visibility).toBe('private');
    expect(await memberWorks.listByConversation({ topicId })).toHaveLength(0);
  });

  it('keeps an orphaned document Work (backing row deleted) visible to the registrant only', async () => {
    await seedWorkspace();
    const ownerWorks = new WorkModel(serverDB, userId, workspaceId);
    const memberWorks = new WorkModel(serverDB, userId2, workspaceId);

    const { doc } = await registerWorkspaceDocument('public');

    // Hard-delete the backing document outside the tool path: the Work survives
    // as an orphan. With no backing row the EXISTS guard fails, so only the
    // registrant keeps the orphan card.
    await serverDB.delete(documents).where(eq(documents.id, doc.documentId));

    expect(await ownerWorks.listByConversation({ topicId })).toHaveLength(1);
    expect(await memberWorks.listByConversation({ topicId })).toHaveLength(0);
  });
});
