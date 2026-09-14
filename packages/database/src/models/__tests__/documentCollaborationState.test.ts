// @vitest-environment node

import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documentCollaborationStates, documentHistories, documents, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DocumentModel } from '../document';
import {
  DOCUMENT_COLLABORATION_SNAPSHOT_MISSING,
  DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH,
  DOCUMENT_COLLABORATION_STATE_ABSENT_TOKEN,
  DocumentCollaborationStateModel,
} from '../documentCollaborationState';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'document-collaboration-state-test-user';
const otherUserId = 'document-collaboration-state-test-other-user';

let documentId: string;
let model: DocumentCollaborationStateModel;

const nextProjection = (id: string, revision: number, content: string) => ({
  content,
  editorData: { root: { children: [{ text: content }] } },
  roomId: id,
  roomRevision: revision,
  snapshotUpdate: Buffer.from(`snapshot-${revision}`).toString('base64'),
  stateVector: `state-vector-${revision}`,
});

beforeEach(async () => {
  await serverDB
    .delete(documentCollaborationStates)
    .where(inArray(documentCollaborationStates.userId, [userId, otherUserId]));
  await serverDB.delete(documents).where(inArray(documents.userId, [userId, otherUserId]));
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);

  const document = await new DocumentModel(serverDB, userId).create({
    content: 'Original',
    editorData: { root: { children: [{ text: 'Original' }] } },
    fileType: 'text/plain',
    source: 'test://document-collaboration-state',
    sourceType: 'api',
    title: 'Collaboration state test',
    totalCharCount: 8,
    totalLineCount: 1,
  });
  documentId = document.id;
  model = new DocumentCollaborationStateModel(serverDB, userId);
});

afterEach(async () => {
  await serverDB
    .delete(documentCollaborationStates)
    .where(inArray(documentCollaborationStates.userId, [userId, otherUserId]));
  await serverDB.delete(documents).where(inArray(documents.userId, [userId, otherUserId]));
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('DocumentCollaborationStateModel', () => {
  it('atomically persists the document projection, room ledger, and request-linked history', async () => {
    const expected = await model.readVersion(documentId);
    expect(expected.versionToken).toBe(DOCUMENT_COLLABORATION_STATE_ABSENT_TOKEN);
    const result = await model.persist({
      documentId,
      expected,
      history: {
        idempotencyKey: 'agent_collaboration:request-1',
        requestId: 'request-1',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: nextProjection(documentId, 1, 'Agent result'),
    });

    expect(result.status).toBe('persisted');
    if (result.status !== 'persisted') return;
    expect(result.version.roomRevision).toBe(1);
    expect(result.version.roomId).toBe(documentId);

    const [savedDocument] = await serverDB
      .select({ content: documents.content, editorData: documents.editorData })
      .from(documents)
      .where(eq(documents.id, documentId));
    const [savedState] = await serverDB
      .select()
      .from(documentCollaborationStates)
      .where(eq(documentCollaborationStates.documentId, documentId));
    const [savedHistory] = await serverDB
      .select()
      .from(documentHistories)
      .where(
        and(
          eq(documentHistories.documentId, documentId),
          eq(documentHistories.requestId, 'request-1'),
        ),
      );

    expect(savedDocument).toMatchObject({ content: 'Agent result' });
    expect(savedState).toMatchObject({
      documentId,
      documentUpdatedAt: result.version.documentUpdatedAt,
      roomId: documentId,
      roomRevision: 1,
      snapshotUpdate: Buffer.from('snapshot-1').toString('base64'),
      stateVector: 'state-vector-1',
      versionToken: result.version.versionToken,
    });
    expect(savedHistory).toMatchObject({
      documentId,
      requestId: 'request-1',
      saveSource: 'llm_call',
      source: 'agent_collaboration',
    });
  });

  it('deduplicates an identical snapshot and history key', async () => {
    const expected = await model.readVersion(documentId);
    const next = nextProjection(documentId, 1, 'Agent result');
    const first = await model.persist({
      documentId,
      expected,
      history: {
        idempotencyKey: 'request-1',
        requestId: 'request-1',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next,
    });
    if (first.status !== 'persisted') throw new Error('first persistence did not succeed');

    const duplicate = await model.persist({
      documentId,
      expected: await model.readVersion(documentId),
      history: {
        idempotencyKey: 'request-1',
        requestId: 'request-1',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next,
    });
    expect(duplicate).toMatchObject({ status: 'duplicate' });
    expect(
      await serverDB
        .select()
        .from(documentHistories)
        .where(eq(documentHistories.requestId, 'request-1')),
    ).toHaveLength(1);
  });

  it('persists delete-only snapshots with the same state vector and deduplicates exact replay', async () => {
    const first = await model.persist({
      documentId,
      expected: await model.readVersion(documentId),
      history: {
        idempotencyKey: 'delete-only-first',
        requestId: 'delete-only-first',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: {
        ...nextProjection(documentId, 1, 'Before delete'),
        snapshotUpdate: Buffer.from('snapshot-before-delete').toString('base64'),
        stateVector: 'same-state-vector',
      },
    });
    expect(first.status).toBe('persisted');

    const deleteOnly = await model.persist({
      documentId,
      expected: await model.readVersion(documentId),
      history: {
        idempotencyKey: 'delete-only-second',
        requestId: 'delete-only-second',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: {
        ...nextProjection(documentId, 2, 'After delete'),
        snapshotUpdate: Buffer.from('snapshot-after-delete').toString('base64'),
        stateVector: 'same-state-vector',
      },
    });
    expect(deleteOnly.status).toBe('persisted');

    const sameRevisionDifferentSnapshot = await model.persist({
      documentId,
      expected: await model.readVersion(documentId),
      history: {
        idempotencyKey: 'delete-only-conflict',
        requestId: 'delete-only-conflict',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: {
        ...nextProjection(documentId, 2, 'Conflicting same revision'),
        snapshotUpdate: Buffer.from('snapshot-conflict').toString('base64'),
        stateVector: 'same-state-vector',
      },
    });
    expect(sameRevisionDifferentSnapshot).toEqual({ status: 'conflict' });

    const replay = await model.persist({
      documentId,
      expected: await model.readVersion(documentId),
      history: {
        idempotencyKey: 'delete-only-replay',
        requestId: 'delete-only-replay',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: {
        ...nextProjection(documentId, 3, 'After delete'),
        snapshotUpdate: Buffer.from('snapshot-after-delete').toString('base64'),
        stateVector: 'same-state-vector',
      },
    });
    expect(replay.status).toBe('duplicate');
  });

  it('rejects a stale CAS without changing the document or creating history', async () => {
    const expected = await model.readVersion(documentId);
    const first = await model.persist({
      documentId,
      expected,
      history: {
        idempotencyKey: 'request-1',
        requestId: 'request-1',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: nextProjection(documentId, 1, 'First result'),
    });
    expect(first.status).toBe('persisted');

    const stale = await model.persist({
      documentId,
      expected,
      history: {
        idempotencyKey: 'request-2',
        requestId: 'request-2',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: nextProjection(documentId, 2, 'Stale result'),
    });
    expect(stale).toEqual({ status: 'conflict' });
    const [document] = await serverDB
      .select({ content: documents.content })
      .from(documents)
      .where(eq(documents.id, documentId));
    expect(document?.content).toBe('First result');
    expect(
      await serverDB
        .select()
        .from(documentHistories)
        .where(eq(documentHistories.requestId, 'request-2')),
    ).toHaveLength(0);
  });

  it('detects a browser autosave after readVersion and preserves the human edit', async () => {
    const expected = await model.readVersion(documentId);
    const first = await model.persist({
      documentId,
      expected,
      history: {
        idempotencyKey: 'request-1',
        requestId: 'request-1',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: nextProjection(documentId, 1, 'Initial room result'),
    });
    if (first.status !== 'persisted') throw new Error('first persistence did not succeed');

    const roomExpected = await model.readVersion(documentId);
    const humanUpdatedAt = new Date(roomExpected.documentUpdatedAt.getTime() + 1000);
    await serverDB
      .update(documents)
      .set({
        content: 'Human autosave',
        editorData: { root: { children: [{ text: 'Human autosave' }] } },
        totalCharCount: 13,
        totalLineCount: 1,
        updatedAt: humanUpdatedAt,
      })
      .where(eq(documents.id, documentId));

    const result = await model.persist({
      documentId,
      expected: roomExpected,
      history: {
        idempotencyKey: 'request-2',
        requestId: 'request-2',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: nextProjection(documentId, 2, 'Must not overwrite human'),
    });
    expect(result).toEqual({ status: 'conflict' });
    const [document] = await serverDB
      .select({ content: documents.content })
      .from(documents)
      .where(eq(documents.id, documentId));
    expect(document?.content).toBe('Human autosave');
  });

  it('allows a room write after an autosave that happened before readVersion', async () => {
    const initialExpected = await model.readVersion(documentId);
    const initial = await model.persist({
      documentId,
      expected: initialExpected,
      history: {
        idempotencyKey: 'before-read-initial',
        requestId: 'before-read-initial',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: nextProjection(documentId, 1, 'Initial room state'),
    });
    expect(initial.status).toBe('persisted');

    const humanUpdatedAt = new Date(Date.now() + 1000);
    await serverDB
      .update(documents)
      .set({ updatedAt: humanUpdatedAt, content: 'Human first' })
      .where(eq(documents.id, documentId));
    const expected = await model.readVersion(documentId);
    const result = await model.persist({
      documentId,
      expected,
      history: {
        idempotencyKey: 'request-after-human',
        requestId: 'request-after-human',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: nextProjection(documentId, 2, 'Room after human'),
    });
    expect(result.status).toBe('persisted');
  });

  it('rejects a different room binding and an out-of-scope document', async () => {
    const expected = await model.readVersion(documentId);
    const wrongRoom = await model.persist({
      documentId,
      expected,
      history: {
        idempotencyKey: 'wrong-room',
        requestId: 'wrong-room',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: { ...nextProjection(documentId, 1, 'wrong'), roomId: 'another-room' },
    });
    expect(wrongRoom).toEqual({ status: 'conflict' });

    const otherDocument = await new DocumentModel(serverDB, otherUserId).create({
      content: 'Other',
      fileType: 'text/plain',
      source: 'test://other-document',
      sourceType: 'api',
      title: 'Other',
      totalCharCount: 5,
      totalLineCount: 1,
    });
    await expect(model.readVersion(otherDocument.id)).rejects.toThrow('Document not found');
  });

  it('stores browser collaboration history as autosave without a requestId', async () => {
    const result = await model.persist({
      documentId,
      expected: await model.readVersion(documentId),
      history: {
        idempotencyKey: 'collaboration:browser-snapshot',
        requestId: null,
        saveSource: 'autosave',
        source: 'collaboration',
      },
      next: nextProjection(documentId, 1, 'Browser collaboration'),
    });
    expect(result.status).toBe('persisted');

    const [history] = await serverDB
      .select({
        requestId: documentHistories.requestId,
        saveSource: documentHistories.saveSource,
        source: documentHistories.source,
      })
      .from(documentHistories)
      .where(eq(documentHistories.documentId, documentId));
    expect(history).toEqual({ requestId: null, saveSource: 'autosave', source: 'collaboration' });
  });

  it('atomically seeds one Yjs snapshot and applies a pending local delta after restart', async () => {
    const yjs = await import('yjs');
    const candidateDocs = [new yjs.Doc(), new yjs.Doc()];
    candidateDocs[0].getText('artifact').insert(0, 'artifact');
    candidateDocs[1].getText('artifact').insert(0, 'artifact');
    const candidates = candidateDocs.map((candidate) => ({
      roomId: documentId,
      roomRevision: 0,
      snapshotUpdate: Buffer.from(yjs.encodeStateAsUpdate(candidate)).toString('base64'),
      stateVector: Buffer.from(yjs.encodeStateVector(candidate)).toString('base64'),
    }));

    const expected = await model.readVersion(documentId);
    const [first, second] = await Promise.all(
      candidates.map((seed) =>
        model.ensureSnapshot({
          documentId,
          expectedDocumentUpdatedAt: expected.documentUpdatedAt,
          seed,
        }),
      ),
    );
    expect([first.status, second.status].sort()).toEqual(['existing', 'seeded']);
    expect(first.version.snapshotUpdate).toBe(second.version.snapshotUpdate);
    expect(first.version.stateVector).toBe(second.version.stateVector);

    const restored = new yjs.Doc();
    const durableUpdate = Buffer.from(first.version.snapshotUpdate!, 'base64');
    yjs.applyUpdate(restored, durableUpdate);
    expect(restored.getText('artifact').toString()).toBe('artifact');
    expect(Buffer.from(yjs.encodeStateVector(restored)).toString('base64')).toBe(
      first.version.stateVector,
    );

    const pending = new yjs.Doc();
    yjs.applyUpdate(pending, durableUpdate);
    const beforePending = yjs.encodeStateVector(pending);
    pending.getText('artifact').insert(pending.getText('artifact').length, ' pending');
    const pendingDelta = yjs.encodeStateAsUpdate(pending, beforePending);
    yjs.applyUpdate(restored, pendingDelta);

    expect(restored.getText('artifact').toString()).toBe('artifact pending');
    expect(Buffer.from(yjs.encodeStateVector(restored)).toString('base64')).toBe(
      Buffer.from(yjs.encodeStateVector(pending)).toString('base64'),
    );
  });

  it('rejects legacy rows without bytes until an explicit seedSnapshot operation', async () => {
    const expected = await model.readVersion(documentId);
    const initial = await model.persist({
      documentId,
      expected,
      history: {
        idempotencyKey: 'legacy-seed',
        requestId: 'legacy-seed',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: nextProjection(documentId, 1, 'Legacy projection'),
    });
    if (initial.status !== 'persisted') throw new Error('initial persistence did not succeed');

    await serverDB
      .update(documentCollaborationStates)
      .set({ snapshotUpdate: null })
      .where(eq(documentCollaborationStates.documentId, documentId));
    const legacyVersion = await model.readVersion(documentId);
    await expect(
      model.ensureSnapshot({
        documentId,
        expectedDocumentUpdatedAt: legacyVersion.documentUpdatedAt,
        seed: {
          roomId: documentId,
          roomRevision: legacyVersion.roomRevision,
          snapshotUpdate: Buffer.from('reseeded').toString('base64'),
          stateVector: 'reseeded-state-vector',
        },
      }),
    ).rejects.toThrow(DOCUMENT_COLLABORATION_SNAPSHOT_MISSING);

    const reseeded = await model.seedSnapshot({
      documentId,
      expected: legacyVersion,
      seed: {
        roomId: documentId,
        roomRevision: legacyVersion.roomRevision,
        snapshotUpdate: Buffer.from('reseeded').toString('base64'),
        stateVector: 'reseeded-state-vector',
      },
    });
    expect(reseeded.status).toBe('seeded');
    expect((await model.readVersion(documentId)).snapshotUpdate).toBe(
      Buffer.from('reseeded').toString('base64'),
    );
  });

  it('keeps the ledger document timestamp visible so an external edit cannot load old bytes', async () => {
    const expected = await model.readVersion(documentId);
    const initial = await model.persist({
      documentId,
      expected,
      history: {
        idempotencyKey: 'external-version',
        requestId: 'external-version',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: nextProjection(documentId, 1, 'Persisted projection'),
    });
    if (initial.status !== 'persisted') throw new Error('initial persistence did not succeed');

    const previousLedgerTimestamp = initial.version.persistedDocumentUpdatedAt;
    await serverDB
      .update(documents)
      .set({
        content: 'Restored externally',
        updatedAt: new Date(previousLedgerTimestamp!.getTime() + 1000),
      })
      .where(eq(documents.id, documentId));
    const current = await model.readVersion(documentId);
    expect(current.documentUpdatedAt.getTime()).not.toBe(
      current.persistedDocumentUpdatedAt?.getTime(),
    );
    await expect(
      model.ensureSnapshot({
        documentId,
        expectedDocumentUpdatedAt: current.documentUpdatedAt,
        seed: {
          roomId: documentId,
          roomRevision: current.roomRevision,
          snapshotUpdate: Buffer.from('must-not-overwrite').toString('base64'),
          stateVector: 'must-not-overwrite',
        },
      }),
    ).rejects.toThrow(DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH);
  });
});
