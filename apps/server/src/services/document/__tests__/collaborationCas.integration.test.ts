// @vitest-environment node

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { DocumentModel } from '@/database/models/document';
import { DocumentCollaborationStateModel } from '@/database/models/documentCollaborationState';
import { documentCollaborationStates, documents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { DocumentService } from '../index';

const db: LobeChatDatabase = await getTestDB();
const userId = 'document-collaboration-autosave-cas-user';
let documentId: string;

const editorData = (content: string) => ({
  root: {
    children: [{ children: [{ text: content, type: 'text' }], type: 'paragraph' }],
    type: 'root',
  },
});

beforeEach(async () => {
  await db
    .delete(documentCollaborationStates)
    .where(eq(documentCollaborationStates.userId, userId));
  await db.delete(documents).where(eq(documents.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });

  const document = await new DocumentModel(db, userId).create({
    content: 'Initial document',
    editorData: editorData('Initial document'),
    fileType: 'text/plain',
    source: 'test://document-collaboration-autosave-cas',
    sourceType: 'api',
    title: 'Collaboration autosave CAS',
    totalCharCount: 16,
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

describe('DocumentService collaboration autosave CAS', () => {
  it('rejects an older browser dirty snapshot after a newer room projection commits', async () => {
    const initialDocument = await new DocumentModel(db, userId).findById(documentId);
    if (!initialDocument) throw new Error('Missing test document');
    const staleUpdatedAt = new Date(initialDocument.updatedAt);
    const roomModel = new DocumentCollaborationStateModel(db, userId);
    const expected = await roomModel.readVersion(documentId);

    const roomResult = await roomModel.persist({
      documentId,
      expected,
      history: {
        idempotencyKey: 'agent_collaboration:autosave-cas-room',
        requestId: 'autosave-cas-room-request',
        saveSource: 'llm_call',
        source: 'agent_collaboration',
      },
      next: {
        content: 'Newer room projection',
        editorData: editorData('Newer room projection'),
        roomId: documentId,
        roomRevision: 1,
        stateVector: 'room-state-vector-1',
      },
    });
    expect(roomResult.status).toBe('persisted');

    const browserService = new DocumentService(db, userId);
    await expect(
      browserService.updateDocument(documentId, {
        content: 'Older browser autosave',
        editorData: editorData('Older browser autosave'),
        expectedUpdatedAt: staleUpdatedAt,
        saveSource: 'autosave',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const current = await new DocumentModel(db, userId).findById(documentId);
    expect(current?.content).toBe('Newer room projection');

    const roomVersion = await roomModel.readVersion(documentId);
    await expect(
      browserService.updateDocument(documentId, {
        content: 'Newer room projection',
        editorData: editorData('Newer room projection'),
        expectedCollaborationStateVector: roomVersion.stateVector,
        saveSource: 'autosave',
      }),
    ).resolves.toMatchObject({ id: documentId });
  });

  it('returns the committed document timestamp for the next autosave CAS', async () => {
    const service = new DocumentService(db, userId);
    const document = await new DocumentModel(db, userId).findById(documentId);
    if (!document) throw new Error('Missing test document');

    const result = await service.updateDocument(documentId, {
      content: 'First browser autosave',
      editorData: editorData('First browser autosave'),
      expectedUpdatedAt: document.updatedAt,
      saveSource: 'autosave',
    });
    expect(result.savedAt).toBeInstanceOf(Date);

    const next = await new DocumentModel(db, userId).findById(documentId);
    expect(next?.updatedAt.getTime()).toBe(result.savedAt?.getTime());
  });

  it('allows only one of two concurrent autosaves with the same captured version', async () => {
    const document = await new DocumentModel(db, userId).findById(documentId);
    if (!document) throw new Error('Missing test document');
    const expectedUpdatedAt = new Date(document.updatedAt);
    const browserService = new DocumentService(db, userId);
    const results = await Promise.allSettled([
      browserService.updateDocument(documentId, {
        content: 'Concurrent browser A',
        editorData: editorData('Concurrent browser A'),
        expectedUpdatedAt,
        saveSource: 'autosave',
      }),
      browserService.updateDocument(documentId, {
        content: 'Concurrent browser B',
        editorData: editorData('Concurrent browser B'),
        expectedUpdatedAt,
        saveSource: 'autosave',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const current = await new DocumentModel(db, userId).findById(documentId);
    expect(['Concurrent browser A', 'Concurrent browser B']).toContain(current?.content);
  });
});
