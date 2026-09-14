// @vitest-environment node

import { asc, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { DocumentModel } from '@/database/models/document';
import { DocumentCollaborationStateModel } from '@/database/models/documentCollaborationState';
import { DocumentRewriteRequestModel } from '@/database/models/documentRewriteRequest';
import {
  documentCollaborationStates,
  documentHistories,
  documents,
  users,
} from '@/database/schemas';

import { DocumentService } from '../document';
import { DatabaseDocumentPersistenceRepository } from './databaseRepository';
import {
  createImmutableRoomSnapshotFromEditorData,
  readOnlyHeadlessExporter,
} from './headlessExporter';
import { type CollaborationRoomPersistenceEvent, DocumentPersistenceService } from './persistence';

const db = await getTestDB();
const userId = 'document-collaboration-repository-test-user';
let documentId: string;

const ROOM_UPDATE = Uint8Array.from(
  Buffer.from(
    'ARDzibTiCwAoAQRyb290BV9fZGlyAXcDbHRyBwEEcm9vdAYoAPOJtOILAQZfX3R5cGUBdwlwYXJhZ3JhcGgoAPOJtOILAQhfX2Zvcm1hdAF9ACgA84m04gsBB19fc3R5bGUBdwAoAPOJtOILAQhfX2luZGVudAF9ACgA84m04gsBBV9fZGlyAXcDbHRyKADzibTiCwEMX190ZXh0Rm9ybWF0AX0AKADzibTiCwELX190ZXh0U3R5bGUBdwAHAPOJtOILAQEoAPOJtOILCQZfX3R5cGUBdwR0ZXh0KADzibTiCwkIX19mb3JtYXQBfQAoAPOJtOILCQdfX3N0eWxlAXcAKADzibTiCwkGX19tb2RlAX0AKADzibTiCwkIX19kZXRhaWwBfQCE84m04gsJDXNuYXBzaG90IHRleHQA',
    'base64',
  ),
);

beforeEach(async () => {
  await db
    .delete(documentCollaborationStates)
    .where(eq(documentCollaborationStates.userId, userId));
  await db.delete(documents).where(eq(documents.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  const document = await new DocumentModel(db, userId).create({
    content: 'Before',
    editorData: { root: { children: [] } },
    fileType: 'text/plain',
    source: 'test://document-collaboration-repository',
    sourceType: 'api',
    title: 'Repository test',
    totalCharCount: 6,
    totalLineCount: 1,
  });
  documentId = document.id;
});

afterEach(async () => {
  await db
    .delete(documentCollaborationStates)
    .where(eq(documentCollaborationStates.userId, userId));
  await db.delete(documents).where(eq(documents.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

describe('DatabaseDocumentPersistenceRepository', () => {
  it('persists a real Headless Yjs projection and links history to requestId/source', async () => {
    const service = new DocumentPersistenceService({
      exporter: readOnlyHeadlessExporter,
      repository: new DatabaseDocumentPersistenceRepository(db, userId),
    });
    const input: CollaborationRoomPersistenceEvent = {
      documentId,
      messageIds: ['message-1'],
      principal: { clientKind: 'agent', requestId: 'request-1' },
      requestIds: ['request-1', 'request-2', 'request-3'],
      revision: 1,
      roomId: documentId,
      snapshot: {
        stateVector: new Uint8Array([1]),
        update: new Uint8Array(ROOM_UPDATE),
      },
      updateBytes: ROOM_UPDATE.byteLength,
      updatedAt: Date.now(),
    };

    const result = await service.persist(input);
    expect(result).toMatchObject({ persisted: true, reason: 'persisted', revision: 1 });

    const [savedDocument] = await db
      .select({ content: documents.content })
      .from(documents)
      .where(eq(documents.id, documentId));
    const histories = await db
      .select({ requestId: documentHistories.requestId, source: documentHistories.source })
      .from(documentHistories)
      .where(inArray(documentHistories.requestId, ['request-1', 'request-2', 'request-3']))
      .orderBy(asc(documentHistories.requestId));
    const [savedState] = await db
      .select({ snapshotUpdate: documentCollaborationStates.snapshotUpdate })
      .from(documentCollaborationStates)
      .where(eq(documentCollaborationStates.documentId, documentId));
    expect(savedDocument?.content).toContain('snapshot text');
    expect(savedState?.snapshotUpdate).toBe(Buffer.from(ROOM_UPDATE).toString('base64'));
    expect(histories).toHaveLength(3);
    expect(histories).toEqual([
      { requestId: 'request-1', source: 'agent_collaboration' },
      { requestId: 'request-2', source: 'agent_collaboration' },
      { requestId: 'request-3', source: 'agent_collaboration' },
    ]);
  });

  it('advances request-linked history from a partial room flush to the final projection', async () => {
    const rewriteModel = new DocumentRewriteRequestModel(db, userId);
    const rewrite = await rewriteModel.create({
      agentId: 'agent-history-proof',
      documentId,
      instruction: 'Finish the streamed output',
      selection: {
        endNodeId: 'node-history-proof',
        endOffset: 6,
        kind: 'block',
        quotedText: 'Before',
        quotedTextHash: 'hash:Before',
        startNodeId: 'node-history-proof',
        startOffset: 0,
      },
    });
    await rewriteModel.claim(rewrite.request.id, { attempt: 1, workerId: 'history-worker' });
    await rewriteModel.transition(rewrite.request.id, {
      attempt: 1,
      status: 'syncing',
      workerId: 'history-worker',
    });
    await rewriteModel.transition(rewrite.request.id, {
      attempt: 1,
      status: 'thinking',
      workerId: 'history-worker',
    });
    await rewriteModel.transition(rewrite.request.id, {
      attempt: 1,
      status: 'writing',
      workerId: 'history-worker',
    });
    const exporter = {
      exportProjection: vi
        .fn()
        .mockResolvedValueOnce({ editorData: { revision: 'partial' }, markdown: 'partial' })
        .mockResolvedValueOnce({ editorData: { revision: 'final' }, markdown: 'final' }),
    };
    const service = new DocumentPersistenceService({
      exporter,
      repository: new DatabaseDocumentPersistenceRepository(db, userId),
    });
    const createEvent = (revision: number, byte: number): CollaborationRoomPersistenceEvent => ({
      documentId,
      messageIds: [],
      principal: { clientKind: 'agent', requestId: rewrite.request.id },
      requestIds: [rewrite.request.id],
      revision,
      roomId: documentId,
      snapshot: {
        stateVector: new Uint8Array([revision]),
        update: new Uint8Array([byte]),
      },
      updateBytes: 1,
      updatedAt: Date.now(),
    });

    await service.persist(createEvent(1, 1));
    await service.persist(createEvent(2, 2));

    const [history] = await db
      .select({ editorData: documentHistories.editorData })
      .from(documentHistories)
      .where(eq(documentHistories.requestId, rewrite.request.id));
    expect(history?.editorData).toEqual({ revision: 'final' });
  });

  it('persists the first typed room projection after an empty-document title save', async () => {
    const emptyDocument = await new DocumentModel(db, userId).create({
      content: '',
      editorData: {},
      fileType: 'text/plain',
      source: 'test://document-collaboration-empty-title-typing',
      sourceType: 'api',
      title: 'Untitled',
      totalCharCount: 0,
      totalLineCount: 0,
    });
    const emptySeed = await createImmutableRoomSnapshotFromEditorData({
      content: '',
      editorData: {},
      revision: 0,
      roomId: emptyDocument.id,
    });
    const stateModel = new DocumentCollaborationStateModel(db, userId);
    const initialVersion = await stateModel.readVersion(emptyDocument.id);
    await stateModel.ensureSnapshot({
      documentId: emptyDocument.id,
      expectedDocumentUpdatedAt: initialVersion.documentUpdatedAt,
      seed: {
        roomId: emptyDocument.id,
        roomRevision: emptySeed.revision,
        snapshotUpdate: Buffer.from(emptySeed.update).toString('base64'),
        stateVector: Buffer.from(emptySeed.stateVector).toString('base64'),
      },
    });

    const beforeTitle = await new DocumentModel(db, userId).findById(emptyDocument.id);
    await new DocumentService(db, userId).updateDocument(emptyDocument.id, {
      title: 'Codex collaboration',
    });
    const afterTitle = await new DocumentModel(db, userId).findById(emptyDocument.id);
    expect(afterTitle?.updatedAt).toEqual(beforeTitle?.updatedAt);

    const service = new DocumentPersistenceService({
      exporter: readOnlyHeadlessExporter,
      repository: new DatabaseDocumentPersistenceRepository(db, userId),
    });
    const result = await service.persist({
      documentId: emptyDocument.id,
      messageIds: ['typed-message-1'],
      principal: {
        authoritative: true,
        clientKind: 'browser',
        documentId: emptyDocument.id,
        roomId: emptyDocument.id,
        userId,
        workspaceId: null,
      },
      requestIds: [],
      revision: 1,
      roomId: emptyDocument.id,
      snapshot: {
        stateVector: new Uint8Array([9]),
        update: new Uint8Array(ROOM_UPDATE),
      },
      updateBytes: ROOM_UPDATE.byteLength,
      updatedAt: Date.now(),
    });

    expect(result).toMatchObject({ persisted: true, reason: 'persisted', revision: 1 });
    const [savedDocument] = await db
      .select({ content: documents.content, editorData: documents.editorData })
      .from(documents)
      .where(eq(documents.id, emptyDocument.id));
    const [savedState] = await db
      .select({ roomRevision: documentCollaborationStates.roomRevision })
      .from(documentCollaborationStates)
      .where(eq(documentCollaborationStates.documentId, emptyDocument.id));
    expect(savedDocument?.content).toContain('snapshot text');
    expect(savedDocument?.editorData).not.toEqual({});
    expect(savedState?.roomRevision).toBe(1);
  }, 20_000);
});
