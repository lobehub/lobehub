// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documentAnnotations, documents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentModel } from '../document';
import {
  DocumentAnnotationConflictError,
  DocumentAnnotationModel,
  documentAnnotationRecordFromRow,
  documentAnnotationRecordsFromRows,
} from '../documentAnnotation';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'document-annotation-model-test-user-id';
const otherUserId = 'document-annotation-model-test-other-user-id';
const workspaceId = 'document-annotation-test-workspace';
const otherWorkspaceId = 'document-annotation-test-other-workspace';

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

  it('keeps legacy import ordering deterministic and last-wins within one snapshot', async () => {
    const timestamp = '2026-08-26T00:00:00.000Z';
    const result = await annotationModel.bulkUpsertLegacy(documentId, [
      {
        createdAt: timestamp,
        id: 'legacy-z',
        payload: { text: 'first copy' },
        updatedAt: timestamp,
      },
      {
        createdAt: timestamp,
        id: 'legacy-a',
        payload: { text: 'alphabetically first' },
        updatedAt: timestamp,
      },
      {
        createdAt: timestamp,
        id: 'legacy-z',
        payload: { text: 'last copy wins' },
        updatedAt: timestamp,
      },
    ]);

    expect(result).toMatchObject({ createdCount: 2, unchangedCount: 0, updatedCount: 0 });
    expect(result.annotations.map((annotation) => annotation.id)).toEqual(['legacy-a', 'legacy-z']);
    expect(result.annotations[1]?.payload).toEqual({ text: 'last copy wins' });
  });

  it('treats semantically equal partial upserts as duplicates and preserves fields', async () => {
    const created = await annotationModel.create(documentId, {
      anchorMetadata: { nodeKeys: ['node-1'], selector: { offset: 2 } },
      author: { id: userId },
      id: 'stable-annotation',
      payload: { a: 1, b: [2, { nested: true }] },
      quotedText: 'Stable quote',
    });

    const duplicate = await annotationModel.upsert(documentId, {
      id: created.annotation.id,
      payload: { b: [2, { nested: true }], a: 1 },
    });
    expect(duplicate).toMatchObject({ isDuplicate: true });
    expect(duplicate.annotation.version).toBe(created.annotation.version);
    expect(duplicate.annotation.quotedText).toBe('Stable quote');

    const statusUpdate = await annotationModel.upsert(documentId, {
      id: created.annotation.id,
      status: 'resolved',
    });
    expect(statusUpdate.isDuplicate).toBe(false);
    expect(statusUpdate.annotation.version).toBe(2);
    expect(statusUpdate.annotation.payload).toEqual({ a: 1, b: [2, { nested: true }] });
    expect(statusUpdate.annotation.anchorMetadata).toEqual({
      nodeKeys: ['node-1'],
      selector: { offset: 2 },
    });

    await expect(
      annotationModel.upsert(
        documentId,
        { id: created.annotation.id, payload: { text: 'stale upsert' } },
        created.annotation.version,
      ),
    ).rejects.toBeInstanceOf(DocumentAnnotationConflictError);

    const unchanged = await annotationModel.update(documentId, created.annotation.id, {});
    expect(unchanged.version).toBe(statusUpdate.annotation.version);
    expect(unchanged.payload).toEqual({ a: 1, b: [2, { nested: true }] });
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

  it('does not reinterpret a globally conflicting annotation id as belonging to this document', async () => {
    const otherDocument = await new DocumentModel(serverDB, userId).create({
      content: 'Second document',
      fileType: 'text/plain',
      source: 'test://document-annotation-second',
      sourceType: 'api',
      title: 'Second annotation document',
      totalCharCount: 15,
      totalLineCount: 1,
    });
    await annotationModel.create(otherDocument.id, { id: 'globally-conflicting-id' });

    await expect(
      annotationModel.create(documentId, { id: 'globally-conflicting-id' }),
    ).rejects.toThrow('Document annotation not found');
    expect(await annotationModel.listByDocument(documentId)).toEqual([]);
  });

  it('rejects mutation attempts for a missing annotation without leaking another row', async () => {
    await expect(
      annotationModel.update(documentId, 'missing-annotation', { status: 'resolved' }),
    ).rejects.toThrow('Document annotation not found');
    await expect(annotationModel.softDelete(documentId, 'missing-annotation')).rejects.toThrow(
      'Document annotation not found',
    );
  });

  it('keeps workspace annotations isolated by workspace while allowing the shared scope', async () => {
    await serverDB.insert(workspaces).values([
      {
        id: workspaceId,
        name: 'Annotation Workspace',
        primaryOwnerId: userId,
        slug: 'annotation-workspace',
      },
      {
        id: otherWorkspaceId,
        name: 'Other Annotation Workspace',
        primaryOwnerId: otherUserId,
        slug: 'other-annotation-workspace',
      },
    ]);
    const workspaceDocument = await new DocumentModel(serverDB, userId, workspaceId).create({
      content: 'Workspace annotation document',
      fileType: 'text/plain',
      source: 'test://workspace-annotation',
      sourceType: 'api',
      title: 'Workspace annotation document',
      totalCharCount: 30,
      totalLineCount: 1,
      visibility: 'public',
    });
    const workspaceModel = new DocumentAnnotationModel(serverDB, userId, workspaceId);
    const otherWorkspaceModel = new DocumentAnnotationModel(serverDB, userId, otherWorkspaceId);

    await workspaceModel.create(workspaceDocument.id, { id: 'workspace-annotation' });
    await expect(workspaceModel.listByDocument(workspaceDocument.id)).resolves.toHaveLength(1);
    await expect(otherWorkspaceModel.listByDocument(workspaceDocument.id)).rejects.toThrow(
      'Document not found',
    );
  });

  it('projects node keys while filtering malformed anchor metadata values', async () => {
    const created = await annotationModel.create(documentId, {
      anchorMetadata: { nodeKeys: ['node-1'], source: 'editor' },
      id: 'projection-annotation',
    });
    const malformed = {
      ...created.annotation,
      anchorMetadata: { nodeKeys: ['node-1', 42, null] },
    } as any;

    expect(documentAnnotationRecordFromRow(malformed)).toMatchObject({
      id: 'projection-annotation',
      nodeKeys: ['node-1'],
    });
    expect(
      documentAnnotationRecordFromRow({ ...created.annotation, anchorMetadata: null }),
    ).toMatchObject({
      id: 'projection-annotation',
      nodeKeys: undefined,
    });
    expect(documentAnnotationRecordsFromRows([malformed])).toHaveLength(1);

    const nullAnchor = await annotationModel.create(documentId, {
      anchorMetadata: null,
      id: 'null-anchor-annotation',
    });
    expect(nullAnchor.annotation.anchorMetadata).toBeNull();
  });

  it('makes repeated tombstone deletion idempotent', async () => {
    const created = await annotationModel.create(documentId, { id: 'repeat-delete' });
    const deleted = await annotationModel.softDelete(documentId, created.annotation.id);
    const repeated = await annotationModel.softDelete(documentId, created.annotation.id);

    expect(repeated).toMatchObject({ status: 'deleted', version: deleted.version });
  });
});
