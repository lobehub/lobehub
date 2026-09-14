import { createRequire } from 'node:module';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type * as Yjs from 'yjs';

import {
  createDocumentCollaborationBrowserTicketVerifier,
  DocumentCollaborationBrowserTicketService,
} from '../../apps/server/src/services/documentCollaboration/browserTicket';
import { DocumentRewriteRoomTicketService } from '../../apps/server/src/services/documentRewrite/roomTicket';

const require = createRequire(import.meta.url);
const { Doc, UndoManager, applyUpdate, encodeStateAsUpdate, encodeStateVector } =
  require('yjs') as typeof Yjs;
const { createCollaborationServer } = require('./server.cjs') as {
  createCollaborationServer: (options?: Record<string, unknown>) => {
    cleanupIdleRooms: () => void;
    close: () => Promise<void>;
    flushAllRooms: (reason?: string) => Promise<unknown>;
    flushRoom: (roomId: string, reason?: string) => Promise<unknown>;
    getRoomDiagnostics: () => Array<Record<string, unknown>>;
    listen: (port: number, host?: string) => Promise<{ port: number }>;
    rooms: Map<string, { clients: Set<unknown> }>;
  };
};

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (servers.length > 0) await servers.pop()!.close();
});

const createServer = (options: Record<string, unknown> = {}) => {
  const server = createCollaborationServer({
    exposeRoomDiagnostics: true,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    ...options,
  });
  servers.push(server);
  return server;
};

const connect = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });

const nextMessage = (socket: WebSocket) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const onMessage = (message: WebSocket.RawData) => resolve(JSON.parse(String(message)));
    socket.once('message', onMessage);
    socket.once('error', reject);
  });

const waitForClose = (socket: WebSocket) =>
  new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once('close', (code, reason) => resolve({ code, reason: String(reason) }));
  });

const expectNoMessage = (socket: WebSocket, durationMs = 30) =>
  new Promise<void>((resolve, reject) => {
    const onMessage = (message: WebSocket.RawData) => {
      clearTimeout(timer);
      reject(new Error(`unexpected message: ${String(message)}`));
    };
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      resolve();
    }, durationMs);
    socket.once('message', onMessage);
  });

const connectWithFirstMessage = (url: string) =>
  new Promise<{ message: Record<string, unknown>; socket: WebSocket }>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('message', (message) => resolve({ message: JSON.parse(String(message)), socket }));
    socket.once('error', reject);
  });

const createUpdate = (text: string) => {
  const doc = new Doc();
  doc.getText('root').insert(0, text);
  const update = Buffer.from(encodeStateAsUpdate(doc)).toString('base64');
  doc.destroy();
  return update;
};

const encodeClientUpdate = (update: Uint8Array) => Buffer.from(update).toString('base64');

const captureClientUpdate = (doc: Yjs.Doc, mutate: () => void) => {
  let update: Uint8Array | null = null;
  const onUpdate = (nextUpdate: Uint8Array) => {
    update = nextUpdate;
  };
  doc.on('update', onUpdate);
  try {
    mutate();
  } finally {
    doc.off('update', onUpdate);
  }
  expect(update).toBeInstanceOf(Uint8Array);
  return update!;
};

const createV1Auth = (
  hello: Record<string, unknown>,
  ticket: string,
  clientKind: 'agent' | 'browser' = 'agent',
) => ({
  clientId: 1,
  clientKind,
  nonce: hello.nonce,
  protocol: 'lobe-yjs-v1',
  ticket,
  type: 'auth',
  version: 1,
});

const createFormalV1Auth = (
  hello: Record<string, unknown>,
  input: {
    clientKind?: 'agent' | 'browser';
    documentId?: string;
    requestId?: string;
    ticket?: string;
  } = {},
) => ({
  ...createV1Auth(hello, input.ticket ?? 'ticket', input.clientKind ?? 'agent'),
  ...(input.documentId ? { documentId: input.documentId } : {}),
  ...(input.requestId ? { requestId: input.requestId } : {}),
});

const createV1SyncRequest = () => ({
  protocol: 'lobe-yjs-v1',
  stateVector: Buffer.from([0]).toString('base64'),
  type: 'sync-request',
  version: 1,
});

describe('page collaboration server', () => {
  it('isolates each document in its own room', async () => {
    const server = createServer();
    const address = await server.listen(0);
    const first = await connect(`ws://127.0.0.1:${address.port}/collaboration/doc-a?clientId=1`);
    const second = await connect(`ws://127.0.0.1:${address.port}/collaboration/doc-b?clientId=2`);

    expect(server.rooms.has('doc-a')).toBe(true);
    expect(server.rooms.has('doc-b')).toBe(true);
    expect(server.rooms.get('doc-a')?.clients.size).toBe(1);
    expect(server.rooms.get('doc-b')?.clients.size).toBe(1);

    first.close();
    second.close();
  });

  it('defers the second initial sync until the bootstrap owner publishes state', async () => {
    const server = createServer();
    const address = await server.listen(0);
    const { message: firstMessage, socket: first } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/doc-a?clientId=1`,
    );
    expect(firstMessage.type).toBe('sync');
    const second = await connect(`ws://127.0.0.1:${address.port}/collaboration/doc-a?clientId=2`);
    await expectNoMessage(second);
    const secondSync = nextMessage(second);

    first.send(JSON.stringify({ type: 'update', update: createUpdate('bootstrapped') }));
    expect((await secondSync).type).toBe('sync');
    first.close();
    second.close();
  });

  it('promotes exactly one deferred client when the owner disconnects', async () => {
    const server = createServer();
    const address = await server.listen(0);
    const { socket: first } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/doc-a?clientId=1`,
    );
    const second = await connect(`ws://127.0.0.1:${address.port}/collaboration/doc-a?clientId=2`);
    const promotedSync = nextMessage(second);
    first.close();
    expect((await promotedSync).type).toBe('sync');

    const third = await connect(`ws://127.0.0.1:${address.port}/collaboration/doc-a?clientId=3`);
    const thirdSync = nextMessage(third);
    second.send(JSON.stringify({ type: 'update', update: createUpdate('owner-transfer') }));
    expect((await thirdSync).type).toBe('sync');
    second.close();
    third.close();
  });

  it('rejects a bootstrap update from a deferred client until it owns the room', async () => {
    const server = createServer();
    const address = await server.listen(0);
    const { socket: first } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/owner-only?clientId=1`,
    );
    const second = await connect(
      `ws://127.0.0.1:${address.port}/collaboration/owner-only?clientId=2`,
    );
    const third = await connect(
      `ws://127.0.0.1:${address.port}/collaboration/owner-only?clientId=3`,
    );
    const secondClosed = waitForClose(second);
    second.send(JSON.stringify({ type: 'update', update: createUpdate('forbidden') }));
    expect((await secondClosed).code).toBe(1008);

    const thirdSync = nextMessage(third);
    first.send(JSON.stringify({ type: 'update', update: createUpdate('owner-update') }));
    expect((await thirdSync).type).toBe('sync');
    first.close();
    third.close();
  });

  it('promotes one deferred client after a bootstrap timeout and closes the old owner', async () => {
    const server = createServer({ bootstrapTimeoutMs: 15 });
    const address = await server.listen(0);
    const { socket: first } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/doc-timeout?clientId=1`,
    );
    const second = await connect(
      `ws://127.0.0.1:${address.port}/collaboration/doc-timeout?clientId=2`,
    );
    const firstClosed = waitForClose(first);
    const promotedSync = nextMessage(second);

    expect((await firstClosed).code).toBe(1013);
    expect((await promotedSync).type).toBe('sync');
    second.close();
  });

  it('keeps a solo bootstrap owner open after its timeout expires', async () => {
    vi.useFakeTimers();
    try {
      const server = createServer({ bootstrapTimeoutMs: 100 });
      const address = await server.listen(0);
      const { socket } = await connectWithFirstMessage(
        `ws://127.0.0.1:${address.port}/collaboration/solo-owner?clientId=1`,
      );

      await vi.advanceTimersByTimeAsync(101);
      expect(socket.readyState).toBe(WebSocket.OPEN);
      socket.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-arms the owner timeout when a deferred client joins later', async () => {
    vi.useFakeTimers();
    try {
      const server = createServer({ bootstrapTimeoutMs: 100 });
      const address = await server.listen(0);
      const { socket: first } = await connectWithFirstMessage(
        `ws://127.0.0.1:${address.port}/collaboration/rearm-owner?clientId=1`,
      );

      await vi.advanceTimersByTimeAsync(101);
      expect(first.readyState).toBe(WebSocket.OPEN);

      const second = await connect(
        `ws://127.0.0.1:${address.port}/collaboration/rearm-owner?clientId=2`,
      );
      const firstClosed = waitForClose(first);
      const promotedSync = nextMessage(second);
      await vi.advanceTimersByTimeAsync(101);

      expect((await firstClosed).code).toBe(1013);
      expect((await promotedSync).type).toBe('sync');
      second.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('broadcasts updates within a room and never across rooms', async () => {
    const server = createServer();
    const address = await server.listen(0);
    const { socket: firstA } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/room-a?clientId=1`,
    );
    const { socket: firstB } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/room-b?clientId=2`,
    );
    firstA.send(JSON.stringify({ type: 'update', update: createUpdate('shared') }));
    firstB.send(JSON.stringify({ type: 'update', update: createUpdate('room-b') }));
    const { socket: secondA } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/room-a?clientId=3`,
    );
    const { socket: secondB } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/room-b?clientId=4`,
    );

    const sameRoomUpdate = nextMessage(secondA);
    const crossRoomCheck = expectNoMessage(secondB);
    firstA.send(JSON.stringify({ type: 'update', update: createUpdate('again') }));
    expect((await sameRoomUpdate).type).toBe('update');
    await crossRoomCheck;
    firstA.close();
    firstB.close();
    secondA.close();
    secondB.close();
  });

  it.each(['legacy', 'v1'] as const)(
    'detects delete-only and Undo/Redo updates for two real Yjs peers over %s',
    async (protocol) => {
      const persisted: Array<Record<string, any>> = [];
      const server = createServer({
        authValidator: protocol === 'v1' ? () => true : undefined,
        onRoomUpdate: async (event: Record<string, any>) => {
          persisted.push(event);
          return { status: 'persisted' };
        },
        roomUpdateDebounceMs: 5,
      });
      const address = await server.listen(0);
      const roomId = `delete-undo-${protocol}`;
      const url = `ws://127.0.0.1:${address.port}/collaboration/${roomId}${
        protocol === 'v1' ? '?protocol=lobe-yjs-v1' : ''
      }`;

      const firstResult = await connectWithFirstMessage(url);
      const first = firstResult.socket;
      let second: WebSocket;
      let secondSync: Promise<Record<string, unknown>>;
      if (protocol === 'v1') {
        expect(firstResult.message).toMatchObject({ type: 'hello', protocol: 'lobe-yjs-v1' });
        const firstAuth = nextMessage(first);
        first.send(
          JSON.stringify({
            ...createV1Auth(firstResult.message, 'test-ticket', 'browser'),
            documentId: roomId,
          }),
        );
        await expect(firstAuth).resolves.toMatchObject({ type: 'auth-ok' });
        const firstSync = nextMessage(first);
        first.send(JSON.stringify(createV1SyncRequest()));
        await expect(firstSync).resolves.toMatchObject({ type: 'sync' });

        const secondResult = await connectWithFirstMessage(url);
        second = secondResult.socket;
        const secondAuth = nextMessage(second);
        second.send(
          JSON.stringify({
            ...createV1Auth(secondResult.message, 'test-ticket', 'agent'),
            documentId: roomId,
            requestId: 'delete-undo-agent',
          }),
        );
        await expect(secondAuth).resolves.toMatchObject({ type: 'auth-ok' });
        secondSync = nextMessage(second);
        second.send(JSON.stringify(createV1SyncRequest()));
      } else {
        expect(firstResult.message).toMatchObject({ type: 'sync' });
        second = await connect(url);
        secondSync = nextMessage(second);
      }

      const firstDoc = new Doc();
      const firstRoot = firstDoc.getArray<string>('root');
      const secondDoc = new Doc();
      const secondRoot = secondDoc.getArray<string>('root');
      const sendUpdate = async (update: Uint8Array, messageId: string) => {
        const message =
          protocol === 'v1'
            ? {
                messageId,
                protocol: 'lobe-yjs-v1',
                type: 'update',
                update: encodeClientUpdate(update),
                version: 1,
              }
            : { messageId, type: 'update', update: encodeClientUpdate(update) };
        const acknowledgement = protocol === 'v1' ? nextMessage(first) : null;
        first.send(JSON.stringify(message));
        if (acknowledgement)
          await expect(acknowledgement).resolves.toMatchObject({ type: 'update-ack' });
      };
      const bootstrap = captureClientUpdate(firstDoc, () =>
        firstDoc.transact(() => firstRoot.insert(0, ['seed']), 'bootstrap'),
      );
      await sendUpdate(bootstrap, 'bootstrap-delete-undo');
      const bootstrapSync = await secondSync;
      expect(bootstrapSync.type).toBe('sync');
      applyUpdate(secondDoc, Buffer.from(String(bootstrapSync.update), 'base64'), 'relay');
      expect(secondRoot.toArray()).toEqual(['seed']);
      await vi.waitFor(() => expect(persisted).toHaveLength(1));
      expect(persisted[0].revision).toBe(1);

      const undoManager = new UndoManager(firstRoot, {
        trackedOrigins: new Set(['human']),
      });
      undoManager.clear();
      const stateVectorBeforeDelete = Buffer.from(encodeStateVector(firstDoc));
      const deleteUpdate = captureClientUpdate(firstDoc, () =>
        firstDoc.transact(() => firstRoot.delete(0, 1), 'human'),
      );
      expect(Buffer.from(encodeStateVector(firstDoc))).toEqual(stateVectorBeforeDelete);
      const deleteBroadcast = nextMessage(second);
      await sendUpdate(deleteUpdate, 'delete-only');
      const deleteMessage = await deleteBroadcast;
      expect(deleteMessage.type).toBe('update');
      applyUpdate(secondDoc, Buffer.from(String(deleteMessage.update), 'base64'), 'relay');
      expect(secondRoot.toArray()).toEqual([]);
      await vi.waitFor(() => expect(persisted).toHaveLength(2));
      expect(persisted[1].revision).toBe(2);
      const deleteSnapshot = new Doc();
      applyUpdate(deleteSnapshot, persisted[1].snapshot.update, 'persisted');
      expect(deleteSnapshot.getArray<string>('root').toArray()).toEqual([]);
      deleteSnapshot.destroy();

      const duplicateDeleteBroadcast = expectNoMessage(second, 80);
      await sendUpdate(deleteUpdate, 'duplicate-delete-only');
      await duplicateDeleteBroadcast;
      expect(persisted).toHaveLength(2);
      expect(server.getRoomDiagnostics()[0]).toMatchObject({ revision: 2, persistedRevision: 2 });

      const undoUpdate = captureClientUpdate(firstDoc, () => undoManager.undo());
      expect(firstRoot.toArray()).toEqual(['seed']);
      const undoBroadcast = nextMessage(second);
      await sendUpdate(undoUpdate, 'undo-delete-only');
      const undoMessage = await undoBroadcast;
      applyUpdate(secondDoc, Buffer.from(String(undoMessage.update), 'base64'), 'relay');
      expect(secondRoot.toArray()).toEqual(['seed']);
      await vi.waitFor(() => expect(persisted).toHaveLength(3));
      expect(persisted[2].revision).toBe(3);

      const redoUpdate = captureClientUpdate(firstDoc, () => undoManager.redo());
      expect(firstRoot.toArray()).toEqual([]);
      const redoBroadcast = nextMessage(second);
      await sendUpdate(redoUpdate, 'redo-delete-only');
      const redoMessage = await redoBroadcast;
      applyUpdate(secondDoc, Buffer.from(String(redoMessage.update), 'base64'), 'relay');
      expect(secondRoot.toArray()).toEqual([]);
      await vi.waitFor(() => expect(persisted).toHaveLength(4));
      expect(persisted.map(({ revision }) => revision)).toEqual([1, 2, 3, 4]);
      const redoSnapshot = new Doc();
      applyUpdate(redoSnapshot, persisted[3].snapshot.update, 'persisted');
      expect(redoSnapshot.getArray<string>('root').toArray()).toEqual([]);
      redoSnapshot.destroy();

      undoManager.destroy();
      firstDoc.destroy();
      secondDoc.destroy();
      first.close();
      second.close();
    },
  );

  it('supports authenticated v1 clients, awareness, incremental sync, and sender validation', async () => {
    const server = createServer({
      authValidator: ({ ticket }: { ticket?: string | null }) => ticket === 'agent-ticket',
    });
    const address = await server.listen(0);
    const firstResult = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/v1-room?clientId=91&protocol=lobe-yjs-v1`,
    );
    const first = firstResult.socket;
    expect(firstResult.message).toMatchObject({
      protocol: 'lobe-yjs-v1',
      type: 'hello',
      version: 1,
    });

    const authOk = nextMessage(first);
    first.send(JSON.stringify(createV1Auth(firstResult.message, 'agent-ticket', 'browser')));
    expect(await authOk).toMatchObject({ protocol: 'lobe-yjs-v1', type: 'auth-ok', version: 1 });

    const firstSync = nextMessage(first);
    first.send(JSON.stringify(createV1SyncRequest()));
    expect(await firstSync).toMatchObject({ protocol: 'lobe-yjs-v1', type: 'sync', version: 1 });

    first.send(
      JSON.stringify({
        protocol: 'lobe-yjs-v1',
        sequence: 1,
        state: {
          anchorPos: null,
          awarenessData: {
            documentId: 'v1-room',
            requestId: 'request-1',
            role: 'agent',
            status: 'thinking',
          },
          color: '#7c3aed',
          focusPos: null,
          focusing: true,
          name: 'Agent',
        },
        type: 'awareness',
        version: 1,
      }),
    );
    await expectNoMessage(first);

    const updateAck = nextMessage(first);
    first.send(
      JSON.stringify({
        messageId: 'v1-update-1',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('v1-update'),
        version: 1,
      }),
    );
    expect(await updateAck).toMatchObject({
      messageId: 'v1-update-1',
      protocol: 'lobe-yjs-v1',
      type: 'update-ack',
    });

    const secondResult = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/v1-room?clientId=92&protocol=lobe-yjs-v1`,
    );
    const second = secondResult.socket;
    const secondAuthOk = nextMessage(second);
    second.send(JSON.stringify(createV1Auth(secondResult.message, 'agent-ticket')));
    expect(await secondAuthOk).toMatchObject({ type: 'auth-ok' });
    const secondSync = nextMessage(second);
    second.send(JSON.stringify(createV1SyncRequest()));
    expect(await secondSync).toMatchObject({
      awareness: [
        expect.objectContaining({
          state: expect.objectContaining({
            awarenessData: expect.objectContaining({ requestId: 'request-1' }),
          }),
        }),
      ],
      protocol: 'lobe-yjs-v1',
      type: 'sync',
    });

    const spoofError = nextMessage(first);
    const spoofClosed = waitForClose(first);
    first.send(
      JSON.stringify({
        messageId: 'spoofed',
        protocol: 'lobe-yjs-v1',
        sender: 999,
        type: 'update',
        update: createUpdate('must-reject'),
        version: 1,
      }),
    );
    expect(await spoofError).toMatchObject({
      code: 'sender_forbidden',
      protocol: 'lobe-yjs-v1',
      type: 'error',
    });
    expect((await spoofClosed).code).toBe(1008);

    second.close();
  });

  it('enforces canWrite on v1 room updates while allowing read-only awareness', async () => {
    const server = createServer({
      ticketVerifier: ({ clientKind, documentId, roomId }: Record<string, unknown>) => ({
        allowed: true,
        clientKind,
        documentId: documentId || roomId,
        expiresAt: Date.now() + 60_000,
        jti: `readonly-${String(roomId)}`,
        principal: {
          canWrite: false,
          clientKind,
          documentId: documentId || roomId,
          roomId,
        },
        roomId,
        singleUse: false,
      }),
    });
    const address = await server.listen(0);
    const connected = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/read-only?protocol=lobe-yjs-v1`,
    );
    const socket = connected.socket;
    const authOk = nextMessage(socket);
    socket.send(
      JSON.stringify(
        createFormalV1Auth(connected.message, {
          clientKind: 'browser',
          documentId: 'read-only',
          ticket: 'browser-ticket',
        }),
      ),
    );
    await authOk;
    const sync = nextMessage(socket);
    socket.send(JSON.stringify(createV1SyncRequest()));
    await sync;

    // Awareness is presentation state and remains available to a viewer.
    socket.send(
      JSON.stringify({
        protocol: 'lobe-yjs-v1',
        sequence: 1,
        state: {
          anchorPos: null,
          awarenessData: { documentId: 'read-only', role: 'browser', status: 'thinking' },
          color: '#1677ff',
          focusPos: null,
          focusing: true,
          name: 'Viewer',
        },
        type: 'awareness',
        version: 1,
      }),
    );
    await expectNoMessage(socket);

    const readOnlyError = nextMessage(socket);
    const closed = waitForClose(socket);
    socket.send(
      JSON.stringify({
        messageId: 'read-only-update',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('must-not-write'),
        version: 1,
      }),
    );
    expect(await readOnlyError).toMatchObject({
      code: 'read_only',
      protocol: 'lobe-yjs-v1',
      type: 'error',
    });
    expect((await closed).code).toBe(1008);
  });

  it('assigns unique relay client identities instead of trusting client-reported ids', async () => {
    const server = createServer({
      // This protocol-level identity test intentionally opens two browser
      // sockets; the production/default room contract is one browser.
      maxBrowserClients: 2,
      ticketVerifier: ({ clientKind, documentId, roomId }: Record<string, unknown>) => ({
        allowed: true,
        clientId: 999,
        clientKind,
        documentId: documentId || roomId,
        expiresAt: Date.now() + 60_000,
        jti: 'reusable-browser-ticket',
        principal: {
          canWrite: true,
          clientKind,
          documentId: documentId || roomId,
          roomId,
          userId: 'user-1',
          workspaceId: null,
        },
        roomId,
        singleUse: false,
      }),
    });
    const address = await server.listen(0);
    const first = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/client-id-room?clientId=1&protocol=lobe-yjs-v1`,
    );
    const firstAuth = nextMessage(first.socket);
    first.socket.send(
      JSON.stringify(
        createFormalV1Auth(first.message, {
          clientKind: 'browser',
          documentId: 'client-id-room',
          ticket: 'browser-ticket',
        }),
      ),
    );
    const firstAuthMessage = await firstAuth;

    const second = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/client-id-room?clientId=1&protocol=lobe-yjs-v1`,
    );
    const secondAuth = nextMessage(second.socket);
    second.socket.send(
      JSON.stringify(
        createFormalV1Auth(second.message, {
          clientKind: 'browser',
          documentId: 'client-id-room',
          ticket: 'browser-ticket',
        }),
      ),
    );
    const secondAuthMessage = await secondAuth;

    expect(firstAuthMessage).toMatchObject({ type: 'auth-ok' });
    expect(secondAuthMessage).toMatchObject({ type: 'auth-ok' });
    expect(firstAuthMessage.clientId).not.toBe(999);
    expect(secondAuthMessage.clientId).not.toBe(999);
    expect(secondAuthMessage.clientId).not.toBe(firstAuthMessage.clientId);
    first.socket.close();
    second.socket.close();
  });

  it('keeps two Agent awareness identities isolated on one authorized document room', async () => {
    const roomId = 'two-agent-awareness-room';
    const server = createServer({
      ticketVerifier: ({
        clientKind,
        documentId,
        requestId,
        roomId: requestedRoomId,
        ticket,
      }: Record<string, unknown>) => {
        if (
          documentId !== roomId ||
          requestedRoomId !== roomId ||
          (clientKind !== 'browser' && clientKind !== 'agent')
        ) {
          return false;
        }
        if (clientKind === 'browser' && ticket === 'browser-ticket') {
          return {
            allowed: true,
            expiresAt: Date.now() + 60_000,
            principal: {
              canWrite: true,
              clientKind: 'browser',
              documentId: roomId,
              roomId,
              userId: 'user-1',
              workspaceId: 'workspace-1',
            },
            singleUse: false,
            ticketId: 'browser-ticket-id',
          };
        }
        if (
          clientKind === 'agent' &&
          (ticket === 'agent-a-ticket' || ticket === 'agent-b-ticket') &&
          typeof requestId === 'string'
        ) {
          return {
            allowed: true,
            expiresAt: Date.now() + 60_000,
            principal: {
              canWrite: true,
              clientKind: 'agent',
              documentId: roomId,
              requestId,
              roomId,
              userId: 'user-1',
              workspaceId: 'workspace-1',
            },
            singleUse: true,
            ticketId: ticket,
          };
        }
        return false;
      },
    });
    const address = await server.listen(0);
    const url = `ws://127.0.0.1:${address.port}/collaboration/${roomId}?protocol=lobe-yjs-v1`;

    const browserResult = await connectWithFirstMessage(url);
    const browser = browserResult.socket;
    const browserAuth = nextMessage(browser);
    browser.send(
      JSON.stringify(
        createFormalV1Auth(browserResult.message, {
          clientKind: 'browser',
          documentId: roomId,
          ticket: 'browser-ticket',
        }),
      ),
    );
    await browserAuth;
    const browserSync = nextMessage(browser);
    browser.send(JSON.stringify(createV1SyncRequest()));
    await browserSync;
    const browserBootstrapAck = nextMessage(browser);
    browser.send(
      JSON.stringify({
        messageId: 'browser-bootstrap',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('bootstrap'),
        version: 1,
      }),
    );
    await browserBootstrapAck;

    const connectAgent = async (ticket: string, requestId: string) => {
      const result = await connectWithFirstMessage(url);
      const auth = nextMessage(result.socket);
      result.socket.send(
        JSON.stringify(
          createFormalV1Auth(result.message, {
            clientKind: 'agent',
            documentId: roomId,
            requestId,
            ticket,
          }),
        ),
      );
      await auth;
      const sync = nextMessage(result.socket);
      result.socket.send(JSON.stringify(createV1SyncRequest()));
      await sync;
      return result.socket;
    };

    const agentA = await connectAgent('agent-a-ticket', 'request-a');
    const agentB = await connectAgent('agent-b-ticket', 'request-b');
    const stateFor = (name: string, requestId: string) => ({
      anchorPos: null,
      awarenessData: { documentId: roomId, requestId, role: 'agent', status: 'thinking' },
      color: name === 'Agent A' ? '#7c3aed' : '#1677ff',
      focusPos: null,
      focusing: true,
      name,
    });

    const awarenessA = nextMessage(browser);
    agentA.send(
      JSON.stringify({
        protocol: 'lobe-yjs-v1',
        sequence: 1,
        state: stateFor('Agent A', 'request-a'),
        type: 'awareness',
        version: 1,
      }),
    );
    const receivedA = await awarenessA;
    const awarenessB = nextMessage(browser);
    agentB.send(
      JSON.stringify({
        protocol: 'lobe-yjs-v1',
        sequence: 1,
        state: stateFor('Agent B', 'request-b'),
        type: 'awareness',
        version: 1,
      }),
    );
    const receivedB = await awarenessB;

    expect(receivedA).toMatchObject({
      state: { awarenessData: { requestId: 'request-a' }, name: 'Agent A' },
      type: 'awareness',
    });
    expect(receivedB).toMatchObject({
      state: { awarenessData: { requestId: 'request-b' }, name: 'Agent B' },
      type: 'awareness',
    });
    expect(receivedA.sender).not.toBe(receivedB.sender);

    agentA.close();
    agentB.close();
    browser.close();
  });

  it('rejects a browser capability from another workspace before it can receive room state', async () => {
    const roomId = 'acl-isolation-room';
    const server = createServer({
      ticketVerifier: ({
        clientKind,
        documentId,
        roomId: requestedRoomId,
        ticket,
      }: Record<string, unknown>) => {
        if (
          clientKind !== 'browser' ||
          documentId !== roomId ||
          requestedRoomId !== roomId ||
          ticket !== 'workspace-one-ticket'
        ) {
          return false;
        }
        return {
          allowed: true,
          expiresAt: Date.now() + 60_000,
          principal: {
            canWrite: true,
            clientKind: 'browser',
            documentId: roomId,
            roomId,
            userId: 'user-one',
            workspaceId: 'workspace-one',
          },
          singleUse: false,
          ticketId: 'workspace-one-ticket-id',
        };
      },
    });
    const address = await server.listen(0);
    const connected = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/${roomId}?protocol=lobe-yjs-v1`,
    );
    const error = nextMessage(connected.socket);
    const closed = waitForClose(connected.socket);
    connected.socket.send(
      JSON.stringify(
        createFormalV1Auth(connected.message, {
          clientKind: 'browser',
          documentId: roomId,
          ticket: 'workspace-two-ticket',
        }),
      ),
    );

    await expect(error).resolves.toMatchObject({
      code: 'unauthorized',
      protocol: 'lobe-yjs-v1',
      type: 'error',
    });
    await expect(closed).resolves.toMatchObject({ code: 1008 });
  });

  it('syncs browser and Agent updates in one v1 room and lets the browser reconnect', async () => {
    const browserTickets = new DocumentCollaborationBrowserTicketService({
      secret: 'browser-room-secret',
    });
    const browserTicket = browserTickets.issue({
      documentId: 'browser-agent-room',
      roomId: 'browser-agent-room',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    const verifyBrowserTicket = createDocumentCollaborationBrowserTicketVerifier({
      authorize: () => true,
      ticketService: browserTickets,
    });
    const server = createServer({
      ticketVerifier: ({
        clientKind,
        documentId,
        requestId,
        roomId,
        ticket,
      }: Record<string, any>) => {
        if (clientKind === 'browser') {
          return verifyBrowserTicket({
            clientKind: 'browser',
            documentId,
            roomId,
            ticket,
          });
        }
        return {
          allowed: ticket === 'agent-ticket',
          clientKind: 'agent',
          documentId,
          expiresAt: Date.now() + 60_000,
          jti: `agent-${String(requestId)}`,
          principal: { canWrite: true, clientKind: 'agent', documentId, requestId, roomId },
          requestId,
          roomId,
        };
      },
    });
    const address = await server.listen(0);
    const browserResult = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/browser-agent-room?protocol=lobe-yjs-v1`,
    );
    const browser = browserResult.socket;
    const browserAuth = nextMessage(browser);
    browser.send(
      JSON.stringify(
        createFormalV1Auth(browserResult.message, {
          clientKind: 'browser',
          documentId: 'browser-agent-room',
          ticket: browserTicket,
        }),
      ),
    );
    await browserAuth;
    const browserSync = nextMessage(browser);
    browser.send(JSON.stringify(createV1SyncRequest()));
    await browserSync;

    const agentResult = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/browser-agent-room?protocol=lobe-yjs-v1`,
    );
    const agent = agentResult.socket;
    const agentAuth = nextMessage(agent);
    agent.send(
      JSON.stringify(
        createFormalV1Auth(agentResult.message, {
          clientKind: 'agent',
          documentId: 'browser-agent-room',
          requestId: 'request-1',
          ticket: 'agent-ticket',
        }),
      ),
    );
    await agentAuth;
    const agentSync = nextMessage(agent);
    agent.send(JSON.stringify(createV1SyncRequest()));
    await expectNoMessage(agent);

    // Browser bootstraps the empty room; Agent receives the initial sync.
    browser.send(
      JSON.stringify({
        messageId: 'browser-bootstrap',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('browser-content'),
        version: 1,
      }),
    );
    expect(await agentSync).toMatchObject({ type: 'sync', protocol: 'lobe-yjs-v1' });
    // The bootstrap update itself is included in the sync, not echoed back to
    // the sender; wait briefly to ensure the Agent has no stray update first.
    await expectNoMessage(agent);

    const agentUpdate = nextMessage(browser);
    const agentAck = nextMessage(agent);
    agent.send(
      JSON.stringify({
        messageId: 'agent-update',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('agent-content'),
        version: 1,
      }),
    );
    expect(await agentUpdate).toMatchObject({
      messageId: 'agent-update',
      type: 'update',
      protocol: 'lobe-yjs-v1',
    });
    expect(await agentAck).toMatchObject({ messageId: 'agent-update', type: 'update-ack' });

    const agentReceivesBrowserUpdate = nextMessage(agent);
    browser.send(
      JSON.stringify({
        messageId: 'browser-update',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('browser-after-agent'),
        version: 1,
      }),
    );
    expect(await agentReceivesBrowserUpdate).toMatchObject({
      messageId: 'browser-update',
      type: 'update',
      protocol: 'lobe-yjs-v1',
    });

    browser.close();
    const reconnectedResult = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/browser-agent-room?protocol=lobe-yjs-v1`,
    );
    const reconnected = reconnectedResult.socket;
    const reconnectAuth = nextMessage(reconnected);
    reconnected.send(
      JSON.stringify(
        createFormalV1Auth(reconnectedResult.message, {
          clientKind: 'browser',
          documentId: 'browser-agent-room',
          ticket: browserTicket,
        }),
      ),
    );
    await reconnectAuth;
    const reconnectSync = nextMessage(reconnected);
    reconnected.send(JSON.stringify(createV1SyncRequest()));
    expect(await reconnectSync).toMatchObject({
      protocol: 'lobe-yjs-v1',
      type: 'sync',
    });
    agent.close();
    reconnected.close();
  });

  it('does not allow a v1 client to sync without a valid ticket', async () => {
    const server = createServer({
      authValidator: ({ ticket }: { ticket?: string | null }) => ticket === 'valid-ticket',
    });
    const address = await server.listen(0);
    const { message: hello, socket } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/auth-required?protocol=lobe-yjs-v1`,
    );
    const error = nextMessage(socket);
    const closed = waitForClose(socket);
    socket.send(JSON.stringify(createV1Auth(hello, 'invalid-ticket')));

    expect(await error).toMatchObject({ code: 'unauthorized', type: 'error' });
    expect((await closed).code).toBe(1008);
  });

  it('does not broadcast v1 room state to an unauthenticated observer', async () => {
    const server = createServer({ authValidator: () => true });
    const address = await server.listen(0);
    const observerResult = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/auth-observer?protocol=lobe-yjs-v1`,
    );
    const observer = observerResult.socket;
    const ownerResult = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/auth-observer?protocol=lobe-yjs-v1`,
    );
    const owner = ownerResult.socket;
    const ownerAuthOk = nextMessage(owner);
    owner.send(JSON.stringify(createV1Auth(ownerResult.message, 'owner', 'browser')));
    await ownerAuthOk;
    const ownerSync = nextMessage(owner);
    owner.send(JSON.stringify(createV1SyncRequest()));
    await ownerSync;

    owner.send(
      JSON.stringify({
        protocol: 'lobe-yjs-v1',
        sequence: 1,
        state: {
          anchorPos: null,
          awarenessData: { documentId: 'auth-observer', requestId: 'owner', role: 'browser' },
          color: '#1677ff',
          focusPos: null,
          focusing: true,
          name: 'Owner',
        },
        type: 'awareness',
        version: 1,
      }),
    );
    owner.send(
      JSON.stringify({
        messageId: 'owner-update',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('owner-update'),
        version: 1,
      }),
    );

    await expectNoMessage(observer);
    owner.close();
    observer.close();
  });

  it('keeps an agent-first empty room deferred until a browser bootstraps it', async () => {
    const server = createServer({ authValidator: () => true });
    const address = await server.listen(0);
    const agentResult = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/agent-first?protocol=lobe-yjs-v1`,
    );
    const agent = agentResult.socket;
    const agentAuthOk = nextMessage(agent);
    agent.send(JSON.stringify(createV1Auth(agentResult.message, 'agent', 'agent')));
    await agentAuthOk;
    const agentSync = nextMessage(agent);
    agent.send(JSON.stringify(createV1SyncRequest()));
    await expectNoMessage(agent);

    const browserResult = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/agent-first?protocol=lobe-yjs-v1`,
    );
    const browser = browserResult.socket;
    const browserAuthOk = nextMessage(browser);
    browser.send(JSON.stringify(createV1Auth(browserResult.message, 'browser', 'browser')));
    await browserAuthOk;
    const browserSync = nextMessage(browser);
    browser.send(JSON.stringify(createV1SyncRequest()));
    expect(await browserSync).toMatchObject({ protocol: 'lobe-yjs-v1', type: 'sync' });

    const agentSyncAfterBootstrap = agentSync;
    browser.send(
      JSON.stringify({
        messageId: 'browser-bootstrap',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('browser-bootstrap'),
        version: 1,
      }),
    );
    expect(await agentSyncAfterBootstrap).toMatchObject({
      protocol: 'lobe-yjs-v1',
      type: 'sync',
    });
    agent.close();
    browser.close();
  });

  it('does not let a deferred Agent bootstrap an empty v1 room', async () => {
    const server = createServer({ authValidator: () => true });
    const address = await server.listen(0);
    const agentResult = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/agent-cannot-bootstrap?protocol=lobe-yjs-v1`,
    );
    const agent = agentResult.socket;
    const authOk = nextMessage(agent);
    agent.send(JSON.stringify(createV1Auth(agentResult.message, 'agent', 'agent')));
    await authOk;
    agent.send(JSON.stringify(createV1SyncRequest()));
    await expectNoMessage(agent);
    const error = nextMessage(agent);
    const closed = waitForClose(agent);
    agent.send(
      JSON.stringify({
        messageId: 'agent-early-update',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('must-not-bootstrap'),
        version: 1,
      }),
    );
    expect(await error).toMatchObject({ code: 'bootstrap_owner_required', type: 'error' });
    expect((await closed).code).toBe(1008);
    expect(server.getRoomDiagnostics()[0]).toMatchObject({ revision: 0 });
  });

  it('fails a deferred Agent when no browser bootstrap owner joins', async () => {
    const server = createServer({ authValidator: () => true, bootstrapTimeoutMs: 15 });
    const address = await server.listen(0);
    const agentResult = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/agent-timeout?protocol=lobe-yjs-v1`,
    );
    const agent = agentResult.socket;
    const authOk = nextMessage(agent);
    agent.send(JSON.stringify(createV1Auth(agentResult.message, 'agent', 'agent')));
    await authOk;

    const error = nextMessage(agent);
    const closed = waitForClose(agent);
    agent.send(JSON.stringify(createV1SyncRequest()));

    expect(await error).toMatchObject({ code: 'bootstrap_timeout', type: 'error' });
    expect((await closed).code).toBe(1013);
  });

  it('re-arms the bounded Agent timeout when a browser owner leaves before bootstrap', async () => {
    const server = createServer({ authValidator: () => true, bootstrapTimeoutMs: 15 });
    const address = await server.listen(0);
    const agentResult = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/agent-owner-leaves?protocol=lobe-yjs-v1`,
    );
    const agent = agentResult.socket;
    const agentAuthOk = nextMessage(agent);
    agent.send(JSON.stringify(createV1Auth(agentResult.message, 'agent', 'agent')));
    await agentAuthOk;
    agent.send(JSON.stringify(createV1SyncRequest()));

    const browserResult = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/agent-owner-leaves?protocol=lobe-yjs-v1`,
    );
    const browser = browserResult.socket;
    const browserAuthOk = nextMessage(browser);
    browser.send(JSON.stringify(createV1Auth(browserResult.message, 'browser', 'browser')));
    await browserAuthOk;
    const browserSync = nextMessage(browser);
    browser.send(JSON.stringify(createV1SyncRequest()));
    await browserSync;

    const agentError = nextMessage(agent);
    const agentClosed = waitForClose(agent);
    const browserClosed = waitForClose(browser);
    browser.close();

    expect(await browserClosed).toMatchObject({ code: 1005 });
    expect(await agentError).toMatchObject({ code: 'bootstrap_timeout', type: 'error' });
    expect((await agentClosed).code).toBe(1013);
  });

  it('closes malformed JSON with code 1003', async () => {
    const server = createServer();
    const address = await server.listen(0);
    const { socket } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/invalid?clientId=1`,
    );
    const closed = waitForClose(socket);
    socket.send('{not-json');
    expect((await closed).code).toBe(1003);
  });

  it('closes an invalid percent-encoded room without throwing in the server', async () => {
    const server = createServer();
    const address = await server.listen(0);
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/collaboration/%E0%A4%A?clientId=1`,
    );
    const closed = waitForClose(socket);
    await expect(
      new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      }),
    ).resolves.toBeUndefined();
    expect((await closed).code).toBe(1008);
  });

  it('lets ws enforce the configured maximum payload with code 1009', async () => {
    const server = createServer({ maxMessageBytes: 64 });
    const address = await server.listen(0);
    const { socket } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/large?clientId=1`,
    );
    const closed = waitForClose(socket);
    socket.send('x'.repeat(128));
    expect((await closed).code).toBe(1009);
  });

  it('serves health, room diagnostics, and an empty 204 OPTIONS response', async () => {
    const server = createServer();
    const address = await server.listen(0);
    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const metrics = await fetch(`http://127.0.0.1:${address.port}/metrics`);
    expect(metrics.status).toBe(200);
    expect(await metrics.json()).toEqual({
      activeRooms: 0,
      backendHealthy: true,
      backendMode: 'memory-local',
      clients: 0,
      idleRooms: 0,
      pendingPersistence: 0,
      rooms: 0,
    });

    const rooms = await fetch(`http://127.0.0.1:${address.port}/rooms`);
    expect(rooms.status).toBe(200);
    expect(await rooms.json()).toEqual({ rooms: [] });

    const options = await fetch(`http://127.0.0.1:${address.port}/health`, { method: 'OPTIONS' });
    expect(options.status).toBe(204);
    expect(await options.text()).toBe('');
  });

  it('does not expose room diagnostics unless explicitly enabled', async () => {
    const server = createCollaborationServer({
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    servers.push(server);
    const address = await server.listen(0);
    const rooms = await fetch(`http://127.0.0.1:${address.port}/rooms`);

    expect(rooms.status).toBe(404);
    expect(await rooms.json()).toEqual({ error: 'Not found' });
  });

  it('can dispose a production composition that fails before it starts listening', async () => {
    const server = createCollaborationServer({
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
    });
    servers.push(server);

    await expect(server.close()).resolves.toBeUndefined();
  });

  it('evicts an empty room when cleanup is explicitly triggered by the injected clock', async () => {
    let clock = 1_000;
    const server = createServer({ now: () => clock, roomIdleTtlMs: 15 });
    const address = await server.listen(0);
    const socket = await connect(
      `ws://127.0.0.1:${address.port}/collaboration/short-lived?clientId=1`,
    );
    const closed = waitForClose(socket);
    socket.close();
    await closed;
    await vi.waitFor(() => expect(server.rooms.get('short-lived')?.clients.size).toBe(0));
    clock += 16;
    server.cleanupIdleRooms();
    expect(server.rooms.has('short-lived')).toBe(false);
  });

  it('fails closed for v1 when no ticket verifier is injected', async () => {
    const server = createServer();
    const address = await server.listen(0);
    const { message: hello, socket } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/no-default-auth?protocol=lobe-yjs-v1`,
    );
    const error = nextMessage(socket);
    const closed = waitForClose(socket);
    socket.send(JSON.stringify(createV1Auth(hello, 'anything')));

    expect(await error).toMatchObject({ code: 'unauthorized', type: 'error' });
    expect((await closed).code).toBe(1008);
  });

  it('closes an authenticated v1 client when its ticket expires', async () => {
    vi.useFakeTimers();
    try {
      let clock = Date.now();
      const server = createServer({
        now: () => clock,
        ticketVerifier: ({ clientKind, documentId, roomId }: Record<string, unknown>) => ({
          allowed: true,
          clientKind,
          documentId: documentId || roomId,
          expiresAt: clock + 100,
          jti: 'expiring-ticket',
          principal: {
            canWrite: false,
            clientKind,
            documentId: documentId || roomId,
            roomId,
          },
          roomId,
          singleUse: false,
        }),
      });
      const address = await server.listen(0);
      const connected = await connectWithFirstMessage(
        `ws://127.0.0.1:${address.port}/collaboration/expiring?protocol=lobe-yjs-v1`,
      );
      const socket = connected.socket;
      const authOk = nextMessage(socket);
      socket.send(
        JSON.stringify(
          createFormalV1Auth(connected.message, {
            clientKind: 'browser',
            documentId: 'expiring',
            ticket: 'browser-ticket',
          }),
        ),
      );
      await authOk;
      const sync = nextMessage(socket);
      socket.send(JSON.stringify(createV1SyncRequest()));
      await sync;

      const error = nextMessage(socket);
      const closed = waitForClose(socket);
      clock += 101;
      await vi.advanceTimersByTimeAsync(101);

      expect(await error).toMatchObject({ code: 'ticket_expired', type: 'error' });
      expect((await closed).code).toBe(1008);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects expired, replayed, and cross-room formal tickets', async () => {
    const expiresAt = Date.now() + 60_000;
    const verifier = ({ roomId, ticket }: { roomId: string; ticket?: string | null }) => ({
      allowed: true,
      clientKind: 'agent',
      documentId: 'document-1',
      expiresAt: ticket === 'expired-ticket' ? Date.now() - 1 : expiresAt,
      jti: `jti-${roomId}`,
      requestId: 'request-1',
      roomId,
    });
    const server = createServer({ ticketVerifier: verifier });
    const address = await server.listen(0);

    const expired = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/expired?protocol=lobe-yjs-v1`,
    );
    const expiredError = nextMessage(expired.socket);
    const expiredClosed = waitForClose(expired.socket);
    expired.socket.send(
      JSON.stringify({
        ...createFormalV1Auth(expired.message, {
          clientKind: 'agent',
          documentId: 'document-1',
          requestId: 'request-1',
          ticket: 'expired-ticket',
        }),
        // The injected verifier intentionally returns an expired result for
        // this room; the server must enforce the returned expiry as well.
      }),
    );
    expect((await expiredError).code).toBe('ticket_expired');
    expect((await expiredClosed).code).toBe(1008);
    await server.close();

    const replayServer = createServer({
      ticketVerifier: ({ roomId }: { roomId: string }) => ({
        allowed: true,
        clientKind: 'agent',
        documentId: 'document-1',
        expiresAt: Date.now() + 60_000,
        jti: 'one-time-jti',
        requestId: 'request-1',
        roomId,
      }),
    });
    const replayAddress = await replayServer.listen(0);
    const first = await connectWithFirstMessage(
      `ws://127.0.0.1:${replayAddress.port}/collaboration/replay?protocol=lobe-yjs-v1`,
    );
    const firstAuth = nextMessage(first.socket);
    first.socket.send(
      JSON.stringify(
        createFormalV1Auth(first.message, {
          documentId: 'document-1',
          requestId: 'request-1',
          ticket: 'same-ticket',
        }),
      ),
    );
    expect(await firstAuth).toMatchObject({ type: 'auth-ok' });
    const second = await connectWithFirstMessage(
      `ws://127.0.0.1:${replayAddress.port}/collaboration/replay?protocol=lobe-yjs-v1`,
    );
    const secondError = nextMessage(second.socket);
    const secondClosed = waitForClose(second.socket);
    second.socket.send(
      JSON.stringify(
        createFormalV1Auth(second.message, {
          documentId: 'document-1',
          requestId: 'request-1',
          ticket: 'same-ticket',
        }),
      ),
    );
    expect(await secondError).toMatchObject({ code: 'ticket_replayed', type: 'error' });
    expect((await secondClosed).code).toBe(1008);
    first.socket.close();
    await replayServer.close();

    const crossRoomServer = createServer({
      ticketVerifier: () => ({
        allowed: true,
        clientKind: 'agent',
        documentId: 'document-1',
        expiresAt: Date.now() + 60_000,
        jti: 'cross-room-jti',
        requestId: 'request-1',
        roomId: 'room-a',
      }),
    });
    const crossAddress = await crossRoomServer.listen(0);
    const cross = await connectWithFirstMessage(
      `ws://127.0.0.1:${crossAddress.port}/collaboration/room-b?protocol=lobe-yjs-v1`,
    );
    const crossError = nextMessage(cross.socket);
    const crossClosed = waitForClose(cross.socket);
    cross.socket.send(
      JSON.stringify(
        createFormalV1Auth(cross.message, {
          documentId: 'document-1',
          requestId: 'request-1',
          ticket: 'cross-ticket',
        }),
      ),
    );
    expect(await crossError).toMatchObject({ code: 'room_mismatch', type: 'error' });
    expect((await crossClosed).code).toBe(1008);
    await crossRoomServer.close();
  });

  it('accepts a ticket issued by DocumentRewriteRoomTicketService and consumes it once', async () => {
    const ticketService = new DocumentRewriteRoomTicketService({ secret: 'integration-secret' });
    const issued = ticketService.issue({
      agentId: 'agent-1',
      attempt: 1,
      documentId: 'document-1',
      requestId: 'request-1',
      roomId: 'issued-room',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });
    const server = createServer({
      ticketVerifier: ({
        clientKind,
        documentId,
        requestId,
        roomId,
        ticket,
      }: Record<string, any>) =>
        ticketService.consume(ticket, {
          clientKind,
          documentId,
          requestId,
          roomId,
        }),
    });
    const address = await server.listen(0);
    const connected = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/issued-room?protocol=lobe-yjs-v1`,
    );
    const auth = nextMessage(connected.socket);
    connected.socket.send(
      JSON.stringify(
        createFormalV1Auth(connected.message, {
          documentId: 'document-1',
          requestId: 'request-1',
          ticket: issued,
        }),
      ),
    );
    expect(await auth).toMatchObject({ type: 'auth-ok', roomId: 'issued-room' });
    connected.socket.close();
  });

  it('enforces independent update and awareness size/rate limits', async () => {
    const server = createServer({
      authValidator: () => true,
      maxAwarenessBytes: 100,
      maxUpdatesPerSecond: 1,
    });
    const address = await server.listen(0);
    const first = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/rate?protocol=lobe-yjs-v1`,
    );
    const authOk = nextMessage(first.socket);
    first.socket.send(JSON.stringify(createV1Auth(first.message, 'test', 'browser')));
    await authOk;
    const sync = nextMessage(first.socket);
    first.socket.send(JSON.stringify(createV1SyncRequest()));
    await sync;

    const update = createUpdate('rate-one');
    const firstAck = nextMessage(first.socket);
    first.socket.send(
      JSON.stringify({
        messageId: 'rate-update-1',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update,
        version: 1,
      }),
    );
    await firstAck;
    const rateError = nextMessage(first.socket);
    const rateClosed = waitForClose(first.socket);
    first.socket.send(
      JSON.stringify({
        messageId: 'rate-update-2',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('rate-two'),
        version: 1,
      }),
    );
    expect(await rateError).toMatchObject({ code: 'rate_limited', type: 'error' });
    expect((await rateClosed).code).toBe(1008);

    const awarenessServer = createServer({ authValidator: () => true, maxAwarenessBytes: 32 });
    const awarenessAddress = await awarenessServer.listen(0);
    const awarenessClient = await connectWithFirstMessage(
      `ws://127.0.0.1:${awarenessAddress.port}/collaboration/awareness?protocol=lobe-yjs-v1`,
    );
    const awarenessAuth = nextMessage(awarenessClient.socket);
    awarenessClient.socket.send(
      JSON.stringify(createV1Auth(awarenessClient.message, 'test', 'browser')),
    );
    await awarenessAuth;
    const awarenessError = nextMessage(awarenessClient.socket);
    const awarenessClosed = waitForClose(awarenessClient.socket);
    awarenessClient.socket.send(
      JSON.stringify({
        protocol: 'lobe-yjs-v1',
        sequence: 1,
        state: null,
        type: 'awareness',
        version: 1,
        extra: 'payload-too-large',
      }),
    );
    expect(await awarenessError).toMatchObject({ code: 'awareness_too_large', type: 'error' });
    expect((await awarenessClosed).code).toBe(1008);
    await awarenessServer.close();
  });

  it('increments room revision, debounces updates, and exposes an immutable snapshot', async () => {
    const persisted: Array<Record<string, any>> = [];
    const server = createServer({
      onRoomUpdate: async (event: Record<string, any>) => {
        persisted.push(event);
        expect(event.doc).toBeUndefined();
        expect(event.snapshot.update).toBeInstanceOf(Uint8Array);
      },
      roomUpdateDebounceMs: 15,
    });
    const address = await server.listen(0);
    const { socket } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/revision`,
    );
    socket.send(JSON.stringify({ type: 'update', update: createUpdate('revision-one') }));
    await vi.waitFor(() => expect(persisted).toHaveLength(1));

    expect(server.getRoomDiagnostics()).toEqual([
      expect.objectContaining({ persistedRevision: 1, revision: 1 }),
    ]);
    expect(persisted[0].revision).toBe(1);
    expect(persisted[0].snapshot.stateVector.byteLength).toBeGreaterThan(0);
    socket.close();
  });

  it('keeps Agent attribution when a human update shares the persistence debounce window', async () => {
    const persisted: Array<Record<string, any>> = [];
    const roomId = 'direct-attribution';
    const server = createServer({
      onRoomUpdate: async (event: Record<string, any>) => persisted.push(event),
      roomUpdateDebounceMs: 20,
      ticketVerifier: ({
        clientKind,
        documentId,
        requestId,
        roomId: requestedRoomId,
        ticket,
      }: Record<string, any>) => ({
        allowed:
          requestedRoomId === roomId &&
          documentId === roomId &&
          ((clientKind === 'browser' && ticket === 'browser-ticket') ||
            (clientKind === 'agent' && ticket === 'agent-ticket')),
        expiresAt: Date.now() + 60_000,
        principal: {
          nonce: `${clientKind}-ticket-id`,
          clientKind,
          documentId,
          ...(clientKind === 'agent' ? { requestId } : {}),
          roomId,
        },
        ticketId: `${clientKind}-ticket-id`,
      }),
    });
    const address = await server.listen(0);
    const browserResult = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/${roomId}?protocol=lobe-yjs-v1`,
    );
    const browser = browserResult.socket;
    const browserAuth = nextMessage(browser);
    browser.send(
      JSON.stringify(
        createFormalV1Auth(browserResult.message, {
          clientKind: 'browser',
          documentId: roomId,
          ticket: 'browser-ticket',
        }),
      ),
    );
    await browserAuth;
    const browserSync = nextMessage(browser);
    browser.send(JSON.stringify(createV1SyncRequest()));
    await browserSync;
    const browserAck = nextMessage(browser);
    browser.send(
      JSON.stringify({
        messageId: 'browser-bootstrap',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('human-before-agent'),
        version: 1,
      }),
    );
    await browserAck;

    const agentResult = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/${roomId}?protocol=lobe-yjs-v1`,
    );
    const agent = agentResult.socket;
    const agentAuth = nextMessage(agent);
    agent.send(
      JSON.stringify(
        createFormalV1Auth(agentResult.message, {
          clientKind: 'agent',
          documentId: roomId,
          requestId: 'direct-request',
          ticket: 'agent-ticket',
        }),
      ),
    );
    await agentAuth;
    const agentSync = nextMessage(agent);
    agent.send(JSON.stringify(createV1SyncRequest()));
    await agentSync;

    agent.send(
      JSON.stringify({
        messageId: 'agent-direct-write',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('agent-direct-write'),
        version: 1,
      }),
    );
    browser.send(
      JSON.stringify({
        messageId: 'browser-overlap-write',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('human-overlap-write'),
        version: 1,
      }),
    );

    await vi.waitFor(() => expect(persisted).toHaveLength(1));
    expect(persisted[0]).toMatchObject({
      principal: { clientKind: 'agent', requestId: 'direct-request', roomId },
      requestIds: ['direct-request'],
    });
    browser.close();
    agent.close();
  });

  it('persists a second revision after an in-flight flush without mixing snapshots', async () => {
    const persisted: Array<Record<string, any>> = [];
    let releaseFirst!: () => void;
    const server = createServer({
      onRoomUpdate: (event: Record<string, any>) => {
        persisted.push({
          revision: event.revision,
          snapshot: event.snapshot,
        });
        if (event.revision === 1) return new Promise<void>((resolve) => (releaseFirst = resolve));
        return undefined;
      },
      roomUpdateDebounceMs: 5,
    });
    const address = await server.listen(0);
    const { socket } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/in-flight`,
    );
    socket.send(JSON.stringify({ type: 'update', update: createUpdate('first') }));
    await vi.waitFor(() => expect(releaseFirst).toEqual(expect.any(Function)));
    socket.send(JSON.stringify({ type: 'update', update: createUpdate('second') }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(persisted).toHaveLength(1);
    releaseFirst();
    await vi.waitFor(() => expect(persisted).toHaveLength(2));

    expect(persisted.map(({ revision }) => revision)).toEqual([1, 2]);
    expect(persisted[0].snapshot.update).not.toEqual(persisted[1].snapshot.update);
    socket.close();
  });

  it('flushes pending persistence before idle TTL eviction and server close', async () => {
    let clock = 1_000;
    const persisted: Array<Record<string, any>> = [];
    const server = createServer({
      now: () => clock,
      onRoomUpdate: async (event: Record<string, any>) => persisted.push(event),
      roomIdleTtlMs: 10,
      roomUpdateDebounceMs: 60_000,
    });
    const address = await server.listen(0);
    const { socket } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/ttl-flush`,
    );
    socket.send(JSON.stringify({ type: 'update', update: createUpdate('ttl') }));
    await vi.waitFor(() =>
      expect(server.getRoomDiagnostics()).toEqual([expect.objectContaining({ revision: 1 })]),
    );
    const closed = waitForClose(socket);
    socket.close();
    await closed;
    await vi.waitFor(() =>
      expect(server.getRoomDiagnostics()).toEqual([
        expect.objectContaining({ clientCount: 0, persistencePending: true }),
      ]),
    );
    clock += 11;
    await server.cleanupIdleRooms();
    expect(persisted).toHaveLength(1);
    expect(server.rooms.has('ttl-flush')).toBe(false);

    const closeServer = createServer({
      onRoomUpdate: async (event: Record<string, any>) => persisted.push(event),
      roomUpdateDebounceMs: 60_000,
    });
    const closeAddress = await closeServer.listen(0);
    const { socket: closeSocket } = await connectWithFirstMessage(
      `ws://127.0.0.1:${closeAddress.port}/collaboration/close-flush`,
    );
    closeSocket.send(JSON.stringify({ type: 'update', update: createUpdate('close') }));
    await vi.waitFor(() =>
      expect(closeServer.getRoomDiagnostics()).toEqual([expect.objectContaining({ revision: 1 })]),
    );
    await closeServer.close();
    expect(persisted).toHaveLength(2);
  });

  it('allows one browser and five independent Agent sessions per v1 room', async () => {
    const roomId = 'five-agent-capacity-room';
    const server = createServer({
      ticketVerifier: async ({
        clientKind,
        documentId,
        requestId,
        roomId: requestedRoomId,
        ticket,
      }: Record<string, unknown>) => {
        // Force all auth completions through an async boundary so the test
        // covers the auth-in-flight reservation, not only serial callbacks.
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (documentId !== roomId || requestedRoomId !== roomId) return false;
        if (clientKind === 'browser' && ticket === 'browser-room-ticket') {
          return {
            allowed: true,
            expiresAt: Date.now() + 60_000,
            principal: {
              canWrite: true,
              clientKind: 'browser',
              documentId: roomId,
              roomId,
              userId: 'capacity-user',
              workspaceId: 'capacity-workspace',
            },
            singleUse: false,
            ticketId: 'browser-capacity-ticket',
          };
        }
        if (
          clientKind === 'agent' &&
          typeof ticket === 'string' &&
          ticket.startsWith('agent-capacity-') &&
          typeof requestId === 'string'
        ) {
          return {
            allowed: true,
            expiresAt: Date.now() + 60_000,
            principal: {
              canWrite: true,
              clientKind: 'agent',
              documentId: roomId,
              requestId,
              roomId,
              userId: 'capacity-user',
              workspaceId: 'capacity-workspace',
            },
            singleUse: true,
            ticketId: ticket,
          };
        }
        return false;
      },
    });
    const address = await server.listen(0);
    const url = `ws://127.0.0.1:${address.port}/collaboration/${roomId}?protocol=lobe-yjs-v1`;

    const authenticate = async (
      clientKind: 'browser' | 'agent',
      ticket: string,
      requestId?: string,
    ) => {
      const connected = await connectWithFirstMessage(url);
      const authResult = nextMessage(connected.socket);
      connected.socket.send(
        JSON.stringify(
          createFormalV1Auth(connected.message, {
            clientKind,
            documentId: roomId,
            ...(requestId ? { requestId } : {}),
            ticket,
          }),
        ),
      );
      return { message: await authResult, socket: connected.socket };
    };

    const browser = await authenticate('browser', 'browser-room-ticket');
    expect(browser.message).toMatchObject({ type: 'auth-ok' });
    const secondBrowser = await authenticate('browser', 'browser-room-ticket');
    expect(secondBrowser.message).toMatchObject({
      code: 'browser_client_limit',
      type: 'error',
    });

    const agents = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        authenticate('agent', `agent-capacity-${index}`, `capacity-request-${index}`),
      ),
    );
    expect(agents.every(({ message }) => message.type === 'auth-ok')).toBe(true);
    for (const [index, agent] of agents.entries()) {
      agent.socket.send(
        JSON.stringify({
          protocol: 'lobe-yjs-v1',
          sequence: 1,
          state: {
            anchorPos: null,
            awarenessData: { requestId: `capacity-request-${index}` },
            color: '#a855f7',
            focusing: true,
            focusPos: null,
            name: `Agent ${index + 1}`,
          },
          type: 'awareness',
          version: 1,
        }),
      );
    }
    await vi.waitFor(() =>
      expect(server.getRoomDiagnostics()).toEqual([
        expect.objectContaining({ awarenessCount: 5, clientCount: 6 }),
      ]),
    );

    const sixthAgent = await authenticate(
      'agent',
      'agent-capacity-sixth',
      'capacity-request-sixth',
    );
    expect(sixthAgent.message).toMatchObject({ code: 'agent_client_limit', type: 'error' });
    expect(server.getRoomDiagnostics()).toEqual([
      expect.objectContaining({ awarenessCount: 5, clientCount: 6 }),
    ]);

    browser.socket.close();
    for (const agent of agents) agent.socket.close();
  });
});
