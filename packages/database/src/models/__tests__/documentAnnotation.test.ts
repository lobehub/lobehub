// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documentAnnotations, documents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentModel } from '../document';
import { DocumentAnnotationConflictError, DocumentAnnotationModel } from '../documentAnnotation';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'document-annotation-model-test-user-id';
const otherUserId = 'document-annotation-model-test-other-user-id';

let documentId: string;
let annotationModel: DocumentAnnotationModel;
let otherAnnotationModel: DocumentAnnotationModel;

beforeEach(async () => {
  await serverDB
    .delete(documentAnnotations)
    .where(inArray(documentAnnotations.userId, [userId, otherUserId]));
  await serverDB.delete(documents).where(inArray(documents.userId, [userId, otherUserId]));
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  const document = await new DocumentModel(serverDB, userId).create({
    content: 'A document to annotate',
    fileType: 'text/plain',
    source: 'test://document-annotation',
    sourceType: 'api',
    title: 'Annotation test document',
    totalCharCount: 22,
    totalLineCount: 1,
  });
  documentId = document.id;
  annotationModel = new DocumentAnnotationModel(serverDB, userId);
  otherAnnotationModel = new DocumentAnnotationModel(serverDB, otherUserId);
});

afterEach(async () => {
  await serverDB
    .delete(documentAnnotations)
    .where(inArray(documentAnnotations.userId, [userId, otherUserId]));
  await serverDB.delete(documents).where(inArray(documents.userId, [userId, otherUserId]));
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('DocumentAnnotationModel', () => {
  it('persists editor anchors and returns editor-compatible records', async () => {
    const result = await annotationModel.create(documentId, {
      author: { id: userId, fullName: 'Annotator' },
      id: 'annotation-1',
      kind: 'comment',
      nodeKeys: ['node-1', 'node-2'],
      payload: { text: 'Please clarify this sentence' },
      quotedText: 'This sentence',
    });

    expect(result.isDuplicate).toBe(false);
    expect(result.annotation).toMatchObject({
      documentId,
      id: 'annotation-1',
      status: 'active',
      userId,
      version: 1,
    });
    expect(result.annotation.anchorMetadata).toEqual({ nodeKeys: ['node-1', 'node-2'] });

    const listed = await annotationModel.listByDocument(documentId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.payload).toEqual({ text: 'Please clarify this sentence' });
  });

  it('bulk upserts legacy snapshots idempotently', async () => {
    const legacy = {
      createdAt: '2026-08-26T00:00:00.000Z',
      id: 'legacy-annotation',
      nodeKeys: ['legacy-node'],
      payload: { text: 'Legacy comment' },
      quotedText: 'Quoted',
      updatedAt: '2026-08-26T00:00:00.000Z',
    };

    const first = await annotationModel.bulkUpsertLegacy(documentId, [legacy]);
    const second = await annotationModel.bulkUpsertLegacy(documentId, [legacy]);

    expect(first.createdCount).toBe(1);
    expect(second).toMatchObject({
      createdCount: 0,
      unchangedCount: 1,
      updatedCount: 0,
    });
    expect(second.annotations[0]?.version).toBe(first.annotations[0]?.version);
    expect(await annotationModel.listByDocument(documentId)).toHaveLength(1);
  });

  it('enforces optimistic versions and soft-deletes without removing history', async () => {
    const created = await annotationModel.create(documentId, {
      id: 'versioned-annotation',
      payload: null,
    });
    const updated = await annotationModel.update(
      documentId,
      created.annotation.id,
      { payload: { text: 'updated' } },
      created.annotation.version,
    );
    expect(updated.version).toBe(2);

    await expect(
      annotationModel.update(
        documentId,
        created.annotation.id,
        { payload: { text: 'stale' } },
        created.annotation.version,
      ),
    ).rejects.toBeInstanceOf(DocumentAnnotationConflictError);

    const deleted = await annotationModel.softDelete(documentId, created.annotation.id, 2);
    expect(deleted).toMatchObject({ status: 'deleted', version: 3 });
    expect(await annotationModel.listByDocument(documentId)).toEqual([]);
    expect(await annotationModel.listByDocument(documentId, { includeDeleted: true })).toHaveLength(
      1,
    );
  });

  it('treats the database as authoritative during legacy imports', async () => {
    const created = await annotationModel.create(documentId, {
      id: 'authoritative-annotation',
      payload: { text: 'original' },
      quotedText: 'old quote',
    });
    const databaseVersion = await annotationModel.updateStatus(
      documentId,
      created.annotation.id,
      'resolved',
      created.annotation.version,
    );
    const databaseRow = await annotationModel.update(
      documentId,
      created.annotation.id,
      { payload: { text: 'database wins' } },
      databaseVersion.version,
    );

    const imported = await annotationModel.bulkUpsertLegacy(documentId, [
      {
        createdAt: '2026-01-01T00:00:00.000Z',
        id: created.annotation.id,
        payload: { text: 'stale embedded payload' },
        quotedText: 'stale quote',
        status: 'active',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    expect(imported).toMatchObject({ createdCount: 0, unchangedCount: 1, updatedCount: 0 });
    expect(imported.annotations[0]).toMatchObject({
      payload: { text: 'database wins' },
      quotedText: 'old quote',
      status: 'resolved',
      version: databaseRow.version,
    });
  });

  it('does not resurrect a deleted tombstone from a legacy active snapshot', async () => {
    const created = await annotationModel.create(documentId, {
      id: 'deleted-annotation',
      payload: { text: 'to be deleted' },
    });
    const deleted = await annotationModel.softDelete(documentId, created.annotation.id, 1);

    const imported = await annotationModel.bulkUpsertLegacy(documentId, [
      {
        id: created.annotation.id,
        payload: { text: 'legacy resurrection attempt' },
        status: 'active',
      },
    ]);

    expect(imported).toMatchObject({ createdCount: 0, unchangedCount: 1, updatedCount: 0 });
    expect(imported.annotations[0]).toMatchObject({
      status: 'deleted',
      version: deleted.version,
    });
    expect(await annotationModel.listByDocument(documentId)).toEqual([]);
  });

  it('does not expose a personal document through another user scope', async () => {
    await expect(otherAnnotationModel.listByDocument(documentId)).rejects.toThrow(
      'Document not found',
    );
    await expect(
      otherAnnotationModel.create(documentId, { id: 'cross-user-annotation' }),
    ).rejects.toThrow('Document not found');

    const rows = await serverDB
      .select()
      .from(documentAnnotations)
      .where(eq(documentAnnotations.documentId, documentId));
    expect(rows).toHaveLength(0);
  });
});
