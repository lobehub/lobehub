// @vitest-environment node
import { createRequire } from 'node:module';

import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import type { DocumentRewriteRoomTicketClaims } from '../../apps/server/src/services/documentRewrite/roomTicket';
import { getTestDB } from '../../packages/database/src/core/getTestDB';
import { DocumentModel } from '../../packages/database/src/models/document';
import { DocumentCollaborationStateModel } from '../../packages/database/src/models/documentCollaborationState';
import { documents, users } from '../../packages/database/src/schemas';
import {
  createPageCollaborationComposition,
  createPageCollaborationRoomSnapshotLoader,
  installPageCollaborationYjsSingleton,
  type PageCollaborationCompositionOptions,
} from './start';

const require = createRequire(import.meta.url);
const db = await getTestDB();
const snapshotLoaderUserId = 'page-collaboration-snapshot-loader-user';
const emptyDocumentSnapshotLoaderUserId = 'page-collaboration-empty-document-loader-user';

const browserClaims = {
  canWrite: true,
  clientKind: 'browser' as const,
  documentId: 'document-1',
  exp: Date.now() + 60_000,
  iat: Date.now(),
  nonce: 'browser-ticket-id',
  roomId: 'document-1',
  userId: 'user-1',
  version: 'lobe-page-browser-v1' as const,
  workspaceId: 'workspace-1',
};

const agentClaims: DocumentRewriteRoomTicketClaims = {
  agentId: 'agent-1',
  attempt: 1,
  clientKind: 'agent',
  documentId: 'document-1',
  exp: Date.now() + 60_000,
  iat: Date.now(),
  nonce: 'agent-ticket-id',
  requestId: 'request-1',
  roomId: 'document-1',
  userId: 'user-1',
  version: 'lobe-rewrite-room-v1',
  workerId: 'worker-1',
  workspaceId: 'workspace-1',
};

const event = (userId: string, workspaceId: string | null) => ({
  documentId: 'document-1',
  messageIds: ['message-1'],
  principal: { clientKind: 'agent', userId, workspaceId },
  requestIds: ['request-1'],
  revision: 1,
  roomId: 'document-1',
  snapshot: { stateVector: new Uint8Array([1]), update: new Uint8Array([2]) },
  updateBytes: 1,
  updatedAt: Date.now(),
});

describe('page collaboration startup composition', () => {
  it('shares the ESM Yjs constructors with the CommonJS relay', async () => {
    const yjs = await import('yjs');
    await installPageCollaborationYjsSingleton();
    const relay = require('./server.cjs') as {
      getYjsDocConstructorForTests: () => typeof yjs.Doc;
    };

    expect(relay.getYjsDocConstructorForTests()).toBe(yjs.Doc);
  });

  it('keeps browser and Agent ticket families separate and authorizes both through injected ACLs', async () => {
    const browserTicketService = {
      verify: vi.fn().mockReturnValue(browserClaims),
    };
    const agentTicketService = {
      consume: vi.fn().mockReturnValue(agentClaims),
    };
    const authorizeBrowser = vi.fn().mockResolvedValue(true);
    const authorizeAgent = vi.fn().mockResolvedValue(true);
    const options: PageCollaborationCompositionOptions = {
      agentTicketService: agentTicketService as never,
      authorizeAgent,
      authorizeBrowser,
      browserTicketService: browserTicketService as never,
    };
    const composition = createPageCollaborationComposition({} as never, options);

    const browser = await composition.ticketVerifier({
      clientKind: 'browser',
      documentId: 'document-1',
      roomId: 'document-1',
      ticket: 'browser-ticket',
    });
    const agent = await composition.ticketVerifier({
      clientKind: 'agent',
      documentId: 'document-1',
      requestId: 'request-1',
      roomId: 'document-1',
      ticket: 'agent-ticket',
      workerId: 'worker-1',
    });

    expect(browser).toMatchObject({
      allowed: true,
      principal: { clientKind: 'browser', documentId: 'document-1' },
      singleUse: false,
    });
    expect(agent).toMatchObject({ allowed: true, principal: { clientKind: 'agent' } });
    expect(authorizeBrowser).toHaveBeenCalledWith(browserClaims);
    expect(authorizeAgent).toHaveBeenCalledWith(agentClaims);
  });

  it('delegates persistence to the authoritative multi-tenant worker', async () => {
    const persistenceWorker = {
      onRoomUpdate: vi.fn(async () => ({ persisted: true })),
    };
    const composition = createPageCollaborationComposition({} as never, {
      authorizeAgent: () => true,
      authorizeBrowser: () => true,
      browserTicketService: { verify: () => browserClaims } as never,
      agentTicketService: { consume: () => agentClaims } as never,
      persistenceWorker,
    });

    await composition.onRoomUpdate(event('user-1', 'workspace-1'));
    await composition.onRoomUpdate(event('user-1', 'workspace-1'));
    await composition.onRoomUpdate(event('user-2', null));

    expect(persistenceWorker.onRoomUpdate).toHaveBeenCalledTimes(3);
  });

  it('fails closed when the authoritative persistence worker is not configured', async () => {
    const composition = createPageCollaborationComposition({} as never, {
      authorizeAgent: () => true,
      authorizeBrowser: () => true,
      browserTicketService: { verify: () => browserClaims } as never,
      agentTicketService: { consume: () => agentClaims } as never,
      persistenceWorker: undefined,
    });

    await expect(
      composition.onRoomUpdate({ ...event('user-1', 'workspace-1'), principal: null }),
    ).rejects.toThrow('persistence worker is not configured');
  });

  it('reloads the exact durable Yjs bytes and state vector after a relay restart', async () => {
    await db.delete(documents).where(eq(documents.userId, snapshotLoaderUserId));
    await db.delete(users).where(eq(users.id, snapshotLoaderUserId));
    await db.insert(users).values({ id: snapshotLoaderUserId });
    const document = await new DocumentModel(db, snapshotLoaderUserId).create({
      content: 'Durable artifact',
      editorData: {
        root: {
          children: [{ children: [{ text: 'Durable artifact', type: 'text' }], type: 'paragraph' }],
          type: 'root',
        },
      },
      fileType: 'text/plain',
      source: 'test://page-collaboration-snapshot-loader',
      sourceType: 'api',
      title: 'Durable snapshot loader',
      totalCharCount: 16,
      totalLineCount: 1,
    });

    try {
      const yjs = await import('yjs');
      const source = new yjs.Doc();
      source.getText('artifact').insert(0, 'artifact');
      const update = yjs.encodeStateAsUpdate(source);
      const stateVector = yjs.encodeStateVector(source);
      const model = new DocumentCollaborationStateModel(db, snapshotLoaderUserId);
      const version = await model.readVersion(document.id);
      await model.ensureSnapshot({
        documentId: document.id,
        expectedDocumentUpdatedAt: version.documentUpdatedAt,
        seed: {
          roomId: document.id,
          roomRevision: 0,
          snapshotUpdate: Buffer.from(update).toString('base64'),
          stateVector: Buffer.from(stateVector).toString('base64'),
        },
      });

      const loader = createPageCollaborationRoomSnapshotLoader(db);
      const loaded = await loader({
        scope: {
          documentId: document.id,
          roomId: document.id,
          userId: snapshotLoaderUserId,
        },
      });
      expect(loaded).not.toBeNull();
      expect(Buffer.from(loaded!.update)).toEqual(Buffer.from(update));
      expect(Buffer.from(loaded!.stateVector)).toEqual(Buffer.from(stateVector));

      const restarted = new yjs.Doc();
      yjs.applyUpdate(restarted, loaded!.update);
      expect(restarted.getText('artifact').toString()).toBe('artifact');
      expect(Buffer.from(yjs.encodeStateVector(restarted))).toEqual(Buffer.from(stateVector));
    } finally {
      await db.delete(documents).where(eq(documents.id, document.id));
      await db.delete(users).where(eq(users.id, snapshotLoaderUserId));
    }
  });

  it('seeds a new empty document once through the real room snapshot loader', async () => {
    await db.delete(documents).where(eq(documents.userId, emptyDocumentSnapshotLoaderUserId));
    await db.delete(users).where(eq(users.id, emptyDocumentSnapshotLoaderUserId));
    await db.insert(users).values({ id: emptyDocumentSnapshotLoaderUserId });
    const document = await new DocumentModel(db, emptyDocumentSnapshotLoaderUserId).create({
      content: '',
      editorData: {},
      fileType: 'text/plain',
      source: 'test://page-collaboration-empty-document-loader',
      sourceType: 'api',
      title: 'Empty document snapshot loader',
      totalCharCount: 0,
      totalLineCount: 0,
    });

    try {
      const loader = createPageCollaborationRoomSnapshotLoader(db);
      const scope = {
        documentId: document.id,
        roomId: document.id,
        userId: emptyDocumentSnapshotLoaderUserId,
      };
      const first = await loader({ scope });
      expect(first).not.toBeNull();
      expect(first!.update.byteLength).toBeGreaterThan(0);
      expect(first!.stateVector.byteLength).toBeGreaterThan(0);

      const model = new DocumentCollaborationStateModel(db, emptyDocumentSnapshotLoaderUserId);
      const seededVersion = await model.readVersion(document.id);
      expect(seededVersion.snapshotUpdate).not.toBeNull();
      expect(seededVersion.versionToken).not.toBe('absent');

      const second = await loader({ scope });
      const reloadedVersion = await model.readVersion(document.id);
      expect(second).toEqual(first);
      expect(reloadedVersion.versionToken).toBe(seededVersion.versionToken);
      expect(reloadedVersion.snapshotUpdate).toBe(seededVersion.snapshotUpdate);
    } finally {
      await db.delete(documents).where(eq(documents.id, document.id));
      await db.delete(users).where(eq(users.id, emptyDocumentSnapshotLoaderUserId));
    }
  }, 20_000);
});
