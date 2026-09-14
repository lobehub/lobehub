import { createRequire } from 'node:module';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type * as Yjs from 'yjs';

import {
  createMemoryCollaborationRoomBackend,
  createPageCollaborationRoomBackend,
  type MemoryRoomBackendStore,
} from './roomBackend';

const require = createRequire(import.meta.url);
const { Doc, UndoManager, applyUpdate, encodeStateAsUpdate, encodeStateVector } =
  require('yjs') as typeof Yjs;
const { createCollaborationServer } = require('./server.cjs') as {
  createCollaborationServer: (options?: Record<string, unknown>) => {
    close: () => Promise<void>;
    listen: (port: number, host?: string) => Promise<{ port: number }>;
    getRoomDiagnostics: () => Array<Record<string, unknown>>;
    rooms: Map<string, { doc: Yjs.Doc }>;
  };
};

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (servers.length > 0) await servers.pop()!.close();
});

const connectWithFirstMessage = (url: string) =>
  new Promise<{ message: Record<string, unknown>; socket: WebSocket }>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('message', (message) => resolve({ message: JSON.parse(String(message)), socket }));
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

const expectNoMessage = (socket: WebSocket, durationMs = 60) =>
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

const authenticate = async (url: string, clientKind: 'agent' | 'browser', requestId?: string) => {
  const result = await connectWithFirstMessage(url);
  const auth = nextMessage(result.socket);
  result.socket.send(
    JSON.stringify({
      clientId: 1,
      clientKind,
      documentId: 'multi-instance-room',
      nonce: result.message.nonce,
      ...(requestId ? { requestId } : {}),
      protocol: 'lobe-yjs-v1',
      ticket: clientKind === 'browser' ? 'browser-ticket' : 'agent-ticket',
      type: 'auth',
      version: 1,
    }),
  );
  await expect(auth).resolves.toMatchObject({ type: 'auth-ok' });
  const sync = nextMessage(result.socket);
  result.socket.send(
    JSON.stringify({
      protocol: 'lobe-yjs-v1',
      stateVector: Buffer.from([0]).toString('base64'),
      type: 'sync-request',
      version: 1,
    }),
  );
  return { ...result, sync };
};

const createUpdate = (text: string) => {
  const doc = new Doc();
  doc.getText('root').insert(0, text);
  const update = Buffer.from(encodeStateAsUpdate(doc)).toString('base64');
  doc.destroy();
  return update;
};

const createSnapshot = (text: string) => {
  const doc = new Doc();
  doc.getText('root').insert(0, text);
  const snapshot = {
    revision: 4,
    stateVector: new Uint8Array(encodeStateVector(doc)),
    update: new Uint8Array(encodeStateAsUpdate(doc)),
  };
  doc.destroy();
  return snapshot;
};

const createMigration =
  (prefix: string) =>
  async ({ doc }: { doc: Yjs.Doc }) => {
    const before = new Uint8Array(encodeStateVector(doc));
    const candidate = new Doc();
    applyUpdate(candidate, encodeStateAsUpdate(doc));
    candidate.getText('root').insert(0, prefix);
    const result = {
      changed: true,
      stateVector: new Uint8Array(encodeStateVector(candidate)),
      update: new Uint8Array(encodeStateAsUpdate(candidate, before)),
    };
    candidate.destroy();
    return result;
  };

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

const createBackend = (instanceId: string, store: MemoryRoomBackendStore) =>
  createMemoryCollaborationRoomBackend({
    instanceId,
    leaseMs: 1_000,
    maxReplayEntries: 8,
    requireScope: true,
    store,
  });

const createTicketVerifier = ({
  clientKind,
  documentId,
  requestId,
  roomId,
}: Record<string, unknown>) => ({
  allowed: true,
  clientKind,
  documentId,
  expiresAt: Date.now() + 60_000,
  jti: clientKind === 'agent' ? `agent-${String(requestId)}` : 'browser-ticket',
  principal: {
    authoritative: true,
    canWrite: true,
    clientKind,
    documentId,
    requestId: requestId ?? null,
    roomId,
    userId: 'user-1',
    workspaceId: 'workspace-1',
  },
  requestId,
  roomId,
  singleUse: clientKind === 'agent',
});

describe('page collaboration cross-instance room backend', () => {
  it('syncs browser A to Agent B, relays awareness, fails over owner, and deduplicates updates', async () => {
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const writesA: unknown[] = [];
    const writesB: unknown[] = [];
    const verifier = createTicketVerifier;
    const createConfiguredServer = (
      backend: ReturnType<typeof createBackend>,
      writes: unknown[],
    ) => {
      const server = createCollaborationServer({
        logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
        onRoomUpdate: async (event: unknown) => {
          writes.push(event);
          return { status: 'persisted' };
        },
        roomBackend: backend,
        ticketVerifier: verifier,
      });
      servers.push(server);
      return server;
    };
    const backendA = createBackend('instance-a', store);
    const backendB = createBackend('instance-b', store);
    const configuredA = createConfiguredServer(backendA, writesA);
    const configuredB = createConfiguredServer(backendB, writesB);
    const addressA = await configuredA.listen(0);
    const addressB = await configuredB.listen(0);

    const browser = await authenticate(
      `ws://127.0.0.1:${addressA.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'browser',
    );
    await expect(browser.sync).resolves.toMatchObject({ type: 'sync' });
    const agent = await authenticate(
      `ws://127.0.0.1:${addressB.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'agent',
      'request-cross-instance',
    );

    const agentSync = agent.sync;
    const browserAck = nextMessage(browser.socket);
    browser.socket.send(
      JSON.stringify({
        messageId: 'browser-cross-instance-update',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('browser A'),
        version: 1,
      }),
    );
    expect(await browserAck).toMatchObject({ type: 'update-ack' });
    expect(await agentSync).toMatchObject({ type: 'sync', revision: 1 });
    expect([...store.rooms.values()][0]?.snapshot?.revision).toBe(1);

    const browserAwareness = nextMessage(browser.socket);
    agent.socket.send(
      JSON.stringify({
        protocol: 'lobe-yjs-v1',
        sequence: 1,
        state: {
          anchorPos: null,
          awarenessData: {
            documentId: 'multi-instance-room',
            requestId: 'request-cross-instance',
            role: 'agent',
            status: 'thinking',
          },
          color: '#7c3aed',
          focusPos: null,
          focusing: true,
          name: 'Agent B',
        },
        type: 'awareness',
        version: 1,
      }),
    );
    await expect(browserAwareness).resolves.toMatchObject({
      state: expect.objectContaining({ name: 'Agent B' }),
      type: 'awareness',
    });

    const replayServer = createConfiguredServer(createBackend('instance-c', store), []);
    const replayAddress = await replayServer.listen(0);
    const replay = await connectWithFirstMessage(
      `ws://127.0.0.1:${replayAddress.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
    );
    const replayError = nextMessage(replay.socket);
    replay.socket.send(
      JSON.stringify({
        clientId: 1,
        clientKind: 'agent',
        documentId: 'multi-instance-room',
        nonce: replay.message.nonce,
        requestId: 'request-cross-instance',
        protocol: 'lobe-yjs-v1',
        ticket: 'agent-ticket',
        type: 'auth',
        version: 1,
      }),
    );
    await expect(replayError).resolves.toMatchObject({ code: 'ticket_replayed' });
    replay.socket.close();

    const backendEnvelope = {
      kind: 'update' as const,
      messageId: 'external-update',
      origin: 'external-instance',
      principal: {
        authoritative: true,
        clientKind: 'agent',
        documentId: 'multi-instance-room',
        requestId: 'external-request',
        roomId: 'multi-instance-room',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
      revision: 7,
      sender: 777_001,
      sequence: 44,
      update: createUpdate('external update'),
    };
    const externalUpdate = nextMessage(agent.socket);
    await backendA.publish(
      {
        documentId: 'multi-instance-room',
        roomId: 'multi-instance-room',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
      backendEnvelope,
    );
    await expect(externalUpdate).resolves.toMatchObject({
      messageId: 'external-update',
      sender: 777_001,
      type: 'update',
    });
    await backendA.publish(
      {
        documentId: 'multi-instance-room',
        roomId: 'multi-instance-room',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
      backendEnvelope,
    );
    await expectNoMessage(agent.socket);

    // A duplicate messageId is acknowledged locally but never published to B.
    const duplicateAcks = Promise.all([nextMessage(browser.socket), nextMessage(browser.socket)]);
    const duplicate = JSON.stringify({
      messageId: 'browser-cross-instance-update',
      protocol: 'lobe-yjs-v1',
      type: 'update',
      update: createUpdate('browser A'),
      version: 1,
    });
    browser.socket.send(duplicate);
    browser.socket.send(duplicate);
    expect(await duplicateAcks).toEqual([
      expect.objectContaining({ type: 'update-ack' }),
      expect.objectContaining({ type: 'update-ack' }),
    ]);
    await expectNoMessage(agent.socket);

    // A's graceful close releases the lease. B renews/claims it and persists
    // the next Agent update with a revision continuing from A.
    browser.socket.close();
    await configuredA.close();
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const agentAck = nextMessage(agent.socket);
    agent.socket.send(
      JSON.stringify({
        messageId: 'agent-after-failover',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('agent B'),
        version: 1,
      }),
    );
    expect(await agentAck).toMatchObject({ type: 'update-ack' });
    await expectNoMessage(agent.socket);
    expect(writesA.length).toBeGreaterThanOrEqual(1);
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(writesB.length).toBeGreaterThanOrEqual(1);
    expect((writesB.at(-1) as { revision?: number }).revision).toBe(8);
    agent.socket.close();
  });

  it('persists delete-only Undo/Redo updates across two memory-backend relays', async () => {
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const writesA: Array<Record<string, any>> = [];
    const createConfiguredServer = (
      backend: ReturnType<typeof createBackend>,
      writes: Array<Record<string, any>>,
    ) => {
      const server = createCollaborationServer({
        logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
        onRoomUpdate: async (event: Record<string, any>) => {
          writes.push(event);
          return { status: 'persisted' };
        },
        roomBackend: backend,
        roomUpdateDebounceMs: 5,
        ticketVerifier: createTicketVerifier,
      });
      servers.push(server);
      return server;
    };
    const configuredA = createConfiguredServer(createBackend('delete-undo-a', store), writesA);
    const configuredB = createConfiguredServer(createBackend('delete-undo-b', store), []);
    const addressA = await configuredA.listen(0);
    const addressB = await configuredB.listen(0);
    const roomUrl = (port: number) =>
      `ws://127.0.0.1:${port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`;

    const browser = await authenticate(roomUrl(addressA.port), 'browser');
    await browser.sync;
    const agent = await authenticate(roomUrl(addressB.port), 'agent', 'delete-undo-agent');
    const browserDoc = new Doc();
    const browserRoot = browserDoc.getArray<string>('root');
    const agentDoc = new Doc();
    const agentRoot = agentDoc.getArray<string>('root');
    const sendBrowserUpdate = async (update: Uint8Array, messageId: string) => {
      const acknowledgement = nextMessage(browser.socket);
      browser.socket.send(
        JSON.stringify({
          messageId,
          protocol: 'lobe-yjs-v1',
          type: 'update',
          update: Buffer.from(update).toString('base64'),
          version: 1,
        }),
      );
      await expect(acknowledgement).resolves.toMatchObject({ type: 'update-ack' });
    };

    const bootstrap = captureClientUpdate(browserDoc, () =>
      browserDoc.transact(() => browserRoot.insert(0, ['seed']), 'bootstrap'),
    );
    const agentSync = agent.sync;
    await sendBrowserUpdate(bootstrap, 'delete-undo-backend-bootstrap');
    const bootstrapMessage = await agentSync;
    expect(bootstrapMessage).toMatchObject({ type: 'sync', revision: 1 });
    applyUpdate(agentDoc, Buffer.from(String(bootstrapMessage.update), 'base64'), 'relay');
    expect(agentRoot.toArray()).toEqual(['seed']);
    await vi.waitFor(() => expect(writesA).toHaveLength(1));

    const undoManager = new UndoManager(browserRoot, {
      trackedOrigins: new Set(['human']),
    });
    undoManager.clear();
    const stateVectorBeforeDelete = Buffer.from(encodeStateVector(browserDoc));
    const deleteUpdate = captureClientUpdate(browserDoc, () =>
      browserDoc.transact(() => browserRoot.delete(0, 1), 'human'),
    );
    expect(Buffer.from(encodeStateVector(browserDoc))).toEqual(stateVectorBeforeDelete);
    const deleteMessage = nextMessage(agent.socket);
    await sendBrowserUpdate(deleteUpdate, 'delete-undo-backend-delete');
    const receivedDelete = await deleteMessage;
    expect(receivedDelete).toMatchObject({ type: 'update', revision: 2 });
    applyUpdate(agentDoc, Buffer.from(String(receivedDelete.update), 'base64'), 'relay');
    expect(agentRoot.toArray()).toEqual([]);
    await vi.waitFor(() => expect(writesA).toHaveLength(2));
    expect(writesA[1].revision).toBe(2);

    const duplicateDelete = expectNoMessage(agent.socket, 100);
    await sendBrowserUpdate(deleteUpdate, 'delete-undo-backend-duplicate');
    await duplicateDelete;
    expect(writesA).toHaveLength(2);
    expect(store.rooms.values().next().value?.revision).toBe(2);

    const undoUpdate = captureClientUpdate(browserDoc, () => undoManager.undo());
    const undoMessage = nextMessage(agent.socket);
    await sendBrowserUpdate(undoUpdate, 'delete-undo-backend-undo');
    const receivedUndo = await undoMessage;
    expect(receivedUndo).toMatchObject({ type: 'update', revision: 3 });
    applyUpdate(agentDoc, Buffer.from(String(receivedUndo.update), 'base64'), 'relay');
    expect(agentRoot.toArray()).toEqual(['seed']);
    await vi.waitFor(() => expect(writesA).toHaveLength(3));

    const redoUpdate = captureClientUpdate(browserDoc, () => undoManager.redo());
    const redoMessage = nextMessage(agent.socket);
    await sendBrowserUpdate(redoUpdate, 'delete-undo-backend-redo');
    const receivedRedo = await redoMessage;
    expect(receivedRedo).toMatchObject({ type: 'update', revision: 4 });
    applyUpdate(agentDoc, Buffer.from(String(receivedRedo.update), 'base64'), 'relay');
    expect(agentRoot.toArray()).toEqual([]);
    await vi.waitFor(() => expect(writesA).toHaveLength(4));
    expect(writesA.map(({ revision }) => revision)).toEqual([1, 2, 3, 4]);

    const finalSnapshot = store.rooms.values().next().value?.snapshot;
    expect(finalSnapshot?.revision).toBe(4);
    const restored = new Doc();
    applyUpdate(restored, finalSnapshot!.update, 'persisted');
    expect(restored.getArray<string>('root').toArray()).toEqual([]);
    restored.destroy();
    undoManager.destroy();
    browserDoc.destroy();
    agentDoc.destroy();
    browser.socket.close();
    agent.socket.close();
  });

  it('shares bounded single-use ticket replay state across instances', async () => {
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const first = createBackend('first', store);
    const second = createBackend('second', store);
    const scope = {
      documentId: 'replay-room',
      roomId: 'replay-room',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    };
    await first.ensureRoom(scope);
    await second.ensureRoom(scope);
    await expect(first.reserveReplay('ticket:one', Date.now() + 60_000)).resolves.toEqual({
      accepted: true,
    });
    await expect(second.reserveReplay('ticket:one', Date.now() + 60_000)).resolves.toEqual({
      accepted: false,
      reason: 'replayed',
    });
    for (let index = 0; index < 8; index += 1) {
      await first.reserveReplay(`ticket:${index + 2}`, Date.now() + 60_000);
    }
    await expect(second.reserveReplay('ticket:overflow', Date.now() + 60_000)).resolves.toEqual({
      accepted: false,
      reason: 'full',
    });
  });

  it('shares one-browser/five-Agent room presence capacity across instances', async () => {
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const first = createBackend('presence-first', store);
    const second = createBackend('presence-second', store);
    const scope = {
      documentId: 'presence-room',
      roomId: 'presence-room',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    };
    const expiresAt = Date.now() + 60_000;

    await expect(
      first.reserveClient!(scope, {
        clientId: 'browser-1',
        clientKind: 'browser',
        expiresAt,
        maxClients: 1,
      }),
    ).resolves.toEqual({ accepted: true });
    await expect(
      second.reserveClient!(scope, {
        clientId: 'browser-2',
        clientKind: 'browser',
        expiresAt,
        maxClients: 1,
      }),
    ).resolves.toEqual({ accepted: false, reason: 'full' });

    for (let index = 0; index < 5; index += 1) {
      await expect(
        (index % 2 === 0 ? first : second).reserveClient!(scope, {
          clientId: `agent-${index}`,
          clientKind: 'agent',
          expiresAt,
          maxClients: 5,
        }),
      ).resolves.toEqual({ accepted: true });
    }
    await expect(
      first.reserveClient!(scope, {
        clientId: 'agent-sixth',
        clientKind: 'agent',
        expiresAt,
        maxClients: 5,
      }),
    ).resolves.toEqual({ accepted: false, reason: 'full' });

    await first.releaseClient!(scope, { clientId: 'agent-0', clientKind: 'agent' });
    await expect(
      second.reserveClient!(scope, {
        clientId: 'agent-replacement',
        clientKind: 'agent',
        expiresAt,
        maxClients: 5,
      }),
    ).resolves.toEqual({ accepted: true });
  });

  it('enforces the shared presence cap when clients land on different relay instances', async () => {
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const backendA = createBackend('auth-presence-a', store);
    const backendB = createBackend('auth-presence-b', store);
    const createConfiguredServer = (backend: typeof backendA) => {
      const server = createCollaborationServer({
        logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
        roomBackend: backend,
        ticketVerifier: createTicketVerifier,
      });
      servers.push(server);
      return server;
    };
    const serverA = createConfiguredServer(backendA);
    const serverB = createConfiguredServer(backendB);
    const addressA = await serverA.listen(0);
    const addressB = await serverB.listen(0);
    const authOnly = async (port: number, clientKind: 'agent' | 'browser', requestId?: string) => {
      const result = await connectWithFirstMessage(
        `ws://127.0.0.1:${port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      );
      const auth = nextMessage(result.socket);
      result.socket.send(
        JSON.stringify({
          clientId: 1,
          clientKind,
          documentId: 'multi-instance-room',
          nonce: result.message.nonce,
          ...(requestId ? { requestId } : {}),
          protocol: 'lobe-yjs-v1',
          ticket: clientKind === 'browser' ? 'browser-ticket' : 'agent-ticket',
          type: 'auth',
          version: 1,
        }),
      );
      return { message: await auth, socket: result.socket };
    };

    const browser = await authOnly(addressA.port, 'browser');
    expect(browser.message).toMatchObject({ type: 'auth-ok' });
    const agents = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        authOnly(index % 2 === 0 ? addressA.port : addressB.port, 'agent', `presence-${index}`),
      ),
    );
    expect(agents.every(({ message }) => message.type === 'auth-ok')).toBe(true);

    const sixth = await authOnly(addressA.port, 'agent', 'presence-sixth');
    expect(sixth.message).toMatchObject({ code: 'agent_client_limit', type: 'error' });
    const secondBrowser = await authOnly(addressB.port, 'browser');
    expect(secondBrowser.message).toMatchObject({ code: 'browser_client_limit', type: 'error' });

    browser.socket.close();
    for (const agent of agents) agent.socket.close();
  });

  it('bootstraps a new relay room from an immutable database snapshot loader', async () => {
    const seed = new Doc();
    seed.getText('root').insert(0, 'database snapshot');
    const snapshot = {
      revision: 12,
      stateVector: new Uint8Array(encodeStateVector(seed)),
      update: new Uint8Array(encodeStateAsUpdate(seed)),
    };
    seed.destroy();
    const backend = createMemoryCollaborationRoomBackend({
      instanceId: 'snapshot-instance',
      requireScope: true,
      snapshotLoader: async () => ({
        revision: snapshot.revision,
        stateVector: new Uint8Array(snapshot.stateVector),
        update: new Uint8Array(snapshot.update),
      }),
    });
    const server = createCollaborationServer({
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      roomBackend: backend,
      ticketVerifier: createTicketVerifier,
    });
    servers.push(server);
    const address = await server.listen(0);
    const browser = await authenticate(
      `ws://127.0.0.1:${address.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'browser',
    );
    const sync = await browser.sync;
    expect(sync).toMatchObject({ revision: 12, type: 'sync' });
    const received = new Doc();
    applyUpdate(received, Buffer.from(String(sync.update), 'base64'));
    expect(received.getText('root').toString()).toBe('database snapshot');
    received.destroy();
    browser.socket.close();
  });

  it('keeps the browser seed protocol when a migration hook has no durable snapshot to migrate', async () => {
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const migrate = vi.fn(async () => {
      throw new Error('migration hook must not run for an unseeded room');
    });
    const backend = createBackend('unseeded-hook-instance', store);
    const server = createCollaborationServer({
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      migrateLegacyBlockImagesInYjsDoc: migrate,
      roomBackend: backend,
      ticketVerifier: createTicketVerifier,
    });
    servers.push(server);
    const address = await server.listen(0);
    const browser = await authenticate(
      `ws://127.0.0.1:${address.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'browser',
    );
    await expect(browser.sync).resolves.toMatchObject({ type: 'sync' });
    expect(migrate).not.toHaveBeenCalled();

    const acknowledgement = nextMessage(browser.socket);
    browser.socket.send(
      JSON.stringify({
        messageId: 'unseeded-browser-seed',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('browser seed'),
        version: 1,
      }),
    );
    await expect(acknowledgement).resolves.toMatchObject({ type: 'update-ack' });
    expect(store.rooms.values().next().value?.snapshot?.bootstrapReady).toBeUndefined();
    browser.socket.close();
  });

  it('keeps a failed snapshot migration outside the live Doc and before the save fence', async () => {
    const snapshot = createSnapshot('legacy');
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const migrate = vi.fn(async () => {
      throw new Error('legacy migration failed');
    });
    const backend = createMemoryCollaborationRoomBackend({
      instanceId: 'failed-migration-instance',
      leaseMs: 1_000,
      requireScope: true,
      snapshotLoader: async () => ({
        revision: snapshot.revision,
        stateVector: new Uint8Array(snapshot.stateVector),
        update: new Uint8Array(snapshot.update),
      }),
      store,
    });
    const server = createCollaborationServer({
      bootstrapTimeoutMs: 5_000,
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      migrateLegacyBlockImagesInYjsDoc: migrate,
      roomBackend: backend,
      ticketVerifier: createTicketVerifier,
    });
    servers.push(server);
    const address = await server.listen(0);
    const browser = await authenticate(
      `ws://127.0.0.1:${address.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'browser',
    );
    await vi.waitFor(() => expect(migrate).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.rooms.get('multi-instance-room')?.doc.getText('root').toString()).toBe('legacy');
    expect(store.rooms.values().next().value?.snapshot?.bootstrapReady).not.toBe(true);
    expect(server.getRoomDiagnostics()[0]).toMatchObject({
      backendBootstrapReady: false,
      backendBootstrapRequired: true,
      deferredSyncClientCount: 1,
    });
    browser.socket.close();
  });

  it('discards a candidate when the owner lease is lost before saveSnapshot', async () => {
    const snapshot = createSnapshot('legacy');
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const baseBackend = createMemoryCollaborationRoomBackend({
      instanceId: 'lost-before-save-instance',
      leaseMs: 1_000,
      requireScope: true,
      snapshotLoader: async () => ({
        revision: snapshot.revision,
        stateVector: new Uint8Array(snapshot.stateVector),
        update: new Uint8Array(snapshot.update),
      }),
      store,
    });
    let ownerChecks = 0;
    const backend = {
      ...baseBackend,
      isOwner: async (scope: Parameters<typeof baseBackend.isOwner>[0]) => {
        ownerChecks += 1;
        return ownerChecks === 0 ? baseBackend.isOwner(scope) : false;
      },
    };
    const server = createCollaborationServer({
      bootstrapTimeoutMs: 5_000,
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      migrateLegacyBlockImagesInYjsDoc: createMigration('should-not-commit-'),
      roomBackend: backend,
      ticketVerifier: createTicketVerifier,
    });
    servers.push(server);
    const address = await server.listen(0);
    const browser = await authenticate(
      `ws://127.0.0.1:${address.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'browser',
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(ownerChecks).toBeGreaterThan(0);
    expect(store.rooms.values().next().value?.snapshot?.bootstrapReady).not.toBe(true);
    expect(server.rooms.get('multi-instance-room')?.doc.getText('root').toString()).toBe('legacy');
    browser.socket.close();
  });

  it('discards a candidate when the durable save fence rejects the snapshot', async () => {
    const snapshot = createSnapshot('legacy');
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const baseBackend = createMemoryCollaborationRoomBackend({
      instanceId: 'save-rejected-instance',
      leaseMs: 1_000,
      requireScope: true,
      snapshotLoader: async () => ({
        revision: snapshot.revision,
        stateVector: new Uint8Array(snapshot.stateVector),
        update: new Uint8Array(snapshot.update),
      }),
      store,
    });
    const saveSnapshot = vi.fn(async () => false);
    const backend = { ...baseBackend, saveSnapshot };
    const server = createCollaborationServer({
      bootstrapTimeoutMs: 5_000,
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      migrateLegacyBlockImagesInYjsDoc: createMigration('save-rejected-'),
      roomBackend: backend,
      ticketVerifier: createTicketVerifier,
    });
    servers.push(server);
    const address = await server.listen(0);
    const browser = await authenticate(
      `ws://127.0.0.1:${address.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'browser',
    );
    await vi.waitFor(() => expect(saveSnapshot).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.rooms.get('multi-instance-room')?.doc.getText('root').toString()).toBe('legacy');
    expect(store.rooms.values().next().value?.snapshot?.bootstrapReady).not.toBe(true);
    browser.socket.close();
  });

  it('recovers a ready snapshot when the owner lease expires immediately after saving it', async () => {
    const snapshot = createSnapshot('legacy');
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const baseBackend = createMemoryCollaborationRoomBackend({
      instanceId: 'save-then-lease-loss-instance',
      leaseMs: 1_000,
      requireScope: true,
      snapshotLoader: async () => ({
        revision: snapshot.revision,
        stateVector: new Uint8Array(snapshot.stateVector),
        update: new Uint8Array(snapshot.update),
      }),
      store,
    });
    let leaseAlive = true;
    const backend = {
      ...baseBackend,
      isOwner: async (scope: Parameters<typeof baseBackend.isOwner>[0]) =>
        leaseAlive && baseBackend.isOwner(scope),
      saveSnapshot: async (...args: Parameters<typeof baseBackend.saveSnapshot>) => {
        const saved = await baseBackend.saveSnapshot(...args);
        leaseAlive = false;
        return saved;
      },
    };
    const server = createCollaborationServer({
      bootstrapTimeoutMs: 5_000,
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      migrateLegacyBlockImagesInYjsDoc: createMigration('recovered-'),
      roomBackend: backend,
      ticketVerifier: createTicketVerifier,
    });
    servers.push(server);
    const address = await server.listen(0);
    const first = await authenticate(
      `ws://127.0.0.1:${address.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'browser',
    );
    await vi.waitFor(() =>
      expect(store.rooms.values().next().value?.snapshot?.bootstrapReady).toBe(true),
    );
    expect(server.rooms.get('multi-instance-room')?.doc.getText('root').toString()).toBe('legacy');
    first.socket.close();

    leaseAlive = true;
    const recovered = await authenticate(
      `ws://127.0.0.1:${address.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'browser',
    );
    await expect(recovered.sync).resolves.toMatchObject({ revision: 5, type: 'sync' });
    expect(server.rooms.get('multi-instance-room')?.doc.getText('root').toString()).toBe(
      'recovered-legacy',
    );
    recovered.socket.close();
  });

  it('allows a fresh sync request to retry after bounded bootstrap attempts are exhausted', async () => {
    const snapshot = createSnapshot('legacy');
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    let attempts = 0;
    const migrate = vi.fn(async ({ doc }: { doc: Yjs.Doc }) => {
      attempts += 1;
      if (attempts <= 3) throw new Error('transient bootstrap failure');
      return {
        changed: false,
        stateVector: new Uint8Array(encodeStateVector(doc)),
        update: new Uint8Array([0, 0]),
      };
    });
    const backend = createMemoryCollaborationRoomBackend({
      instanceId: 'bounded-retry-instance',
      leaseMs: 1_000,
      requireScope: true,
      snapshotLoader: async () => ({
        revision: snapshot.revision,
        stateVector: new Uint8Array(snapshot.stateVector),
        update: new Uint8Array(snapshot.update),
      }),
      store,
    });
    const server = createCollaborationServer({
      bootstrapTimeoutMs: 5_000,
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      migrateLegacyBlockImagesInYjsDoc: migrate,
      roomBackend: backend,
      ticketVerifier: createTicketVerifier,
    });
    servers.push(server);
    const address = await server.listen(0);
    const first = await authenticate(
      `ws://127.0.0.1:${address.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'browser',
    );
    await vi.waitFor(() => expect(migrate).toHaveBeenCalledTimes(3), { timeout: 2_000 });
    expect(first.socket.readyState).toBe(WebSocket.OPEN);
    first.socket.close();

    const recovered = await authenticate(
      `ws://127.0.0.1:${address.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'browser',
    );
    await expect(recovered.sync).resolves.toMatchObject({ revision: 4, type: 'sync' });
    expect(migrate).toHaveBeenCalledTimes(4);
    expect(store.rooms.values().next().value?.snapshot?.bootstrapReady).toBe(true);
    recovered.socket.close();
  });

  it('releases a follower from the committed snapshot when the owner loses the ready notification', async () => {
    const snapshot = createSnapshot('legacy');
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    let releaseMigration!: () => void;
    const migrationGate = new Promise<void>((resolve) => {
      releaseMigration = resolve;
    });
    let migrationStarted!: () => void;
    const migrationStartedPromise = new Promise<void>((resolve) => {
      migrationStarted = resolve;
    });
    const migration = createMigration('lost-notification-');
    const migrate = async (input: { doc: Yjs.Doc }) => {
      migrationStarted();
      await migrationGate;
      return migration(input);
    };
    const baseBackendA = createMemoryCollaborationRoomBackend({
      instanceId: 'lost-notification-a',
      leaseMs: 1_000,
      requireScope: true,
      snapshotLoader: async () => ({
        revision: snapshot.revision,
        stateVector: new Uint8Array(snapshot.stateVector),
        update: new Uint8Array(snapshot.update),
      }),
      store,
    });
    let publishAttempted = false;
    const backendA = {
      ...baseBackendA,
      publish: async () => {
        // Persisted state is intentionally left intact while the notification
        // is lost. Closing this relay below releases its owner lease.
        publishAttempted = true;
        throw new Error('ready notification lost');
      },
    };
    const backendB = createMemoryCollaborationRoomBackend({
      instanceId: 'lost-notification-b',
      leaseMs: 1_000,
      requireScope: true,
      snapshotLoader: async () => ({
        revision: snapshot.revision,
        stateVector: new Uint8Array(snapshot.stateVector),
        update: new Uint8Array(snapshot.update),
      }),
      store,
    });
    const serverA = createCollaborationServer({
      bootstrapTimeoutMs: 5_000,
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      migrateLegacyBlockImagesInYjsDoc: migrate,
      roomBackend: backendA,
      ticketVerifier: createTicketVerifier,
    });
    const serverB = createCollaborationServer({
      bootstrapTimeoutMs: 5_000,
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      migrateLegacyBlockImagesInYjsDoc: migrate,
      roomBackend: backendB,
      ticketVerifier: createTicketVerifier,
    });
    servers.push(serverA, serverB);
    const addressA = await serverA.listen(0);
    const addressB = await serverB.listen(0);
    const browser = await authenticate(
      `ws://127.0.0.1:${addressA.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'browser',
    );
    await migrationStartedPromise;
    const follower = await authenticate(
      `ws://127.0.0.1:${addressB.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'agent',
      'lost-notification-agent',
    );
    releaseMigration();
    await expect(browser.sync).resolves.toMatchObject({ revision: 5, type: 'sync' });
    expect(publishAttempted).toBe(true);
    expect(
      await backendB.isOwner({
        documentId: 'multi-instance-room',
        roomId: 'multi-instance-room',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).toBe(false);

    await expect(follower.sync).resolves.toMatchObject({ revision: 5, type: 'sync' });
    expect(
      await backendB.isOwner({
        documentId: 'multi-instance-room',
        roomId: 'multi-instance-room',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    ).toBe(false);
    const browserUpdate = nextMessage(browser.socket);
    const followerAck = nextMessage(follower.socket);
    follower.socket.send(
      JSON.stringify({
        messageId: 'lost-notification-follow-up',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate(' after-recovery'),
        version: 1,
      }),
    );
    await expect(followerAck).resolves.toMatchObject({ type: 'update-ack' });
    await expect(browserUpdate).resolves.toMatchObject({
      messageId: 'lost-notification-follow-up',
      type: 'update',
    });
    await serverA.close();
    expect(serverB.rooms.get('multi-instance-room')?.doc.getText('root').toString()).toContain(
      'after-recovery',
    );
    expect(store.rooms.values().next().value?.snapshot?.bootstrapReady).toBe(true);
    follower.socket.close();
  }, 30_000);

  it('applies a queued backend update once after the bootstrap envelope opens the gate', async () => {
    const snapshot = createSnapshot('legacy');
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    let releaseMigration!: () => void;
    const migrationGate = new Promise<void>((resolve) => {
      releaseMigration = resolve;
    });
    let migrationStarted!: () => void;
    const migrationStartedPromise = new Promise<void>((resolve) => {
      migrationStarted = resolve;
    });
    const migration = createMigration('migrated-');
    const migrate = async (input: { doc: Yjs.Doc }) => {
      migrationStarted();
      await migrationGate;
      return migration(input);
    };
    const backendA = createMemoryCollaborationRoomBackend({
      instanceId: 'queued-update-a',
      leaseMs: 1_000,
      requireScope: true,
      snapshotLoader: async () => ({
        revision: snapshot.revision,
        stateVector: new Uint8Array(snapshot.stateVector),
        update: new Uint8Array(snapshot.update),
      }),
      store,
    });
    const backendB = createMemoryCollaborationRoomBackend({
      instanceId: 'queued-update-b',
      leaseMs: 1_000,
      requireScope: true,
      snapshotLoader: async () => ({
        revision: snapshot.revision,
        stateVector: new Uint8Array(snapshot.stateVector),
        update: new Uint8Array(snapshot.update),
      }),
      store,
    });
    const serverA = createCollaborationServer({
      bootstrapTimeoutMs: 5_000,
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      migrateLegacyBlockImagesInYjsDoc: migrate,
      roomBackend: backendA,
      ticketVerifier: createTicketVerifier,
    });
    const serverB = createCollaborationServer({
      bootstrapTimeoutMs: 5_000,
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      migrateLegacyBlockImagesInYjsDoc: migrate,
      roomBackend: backendB,
      ticketVerifier: createTicketVerifier,
    });
    servers.push(serverA, serverB);
    const addressA = await serverA.listen(0);
    const addressB = await serverB.listen(0);
    const browser = await authenticate(
      `ws://127.0.0.1:${addressA.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'browser',
    );
    await migrationStartedPromise;
    const follower = await authenticate(
      `ws://127.0.0.1:${addressB.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'agent',
      'queued-update-agent',
    );
    await backendB.publish(
      {
        documentId: 'multi-instance-room',
        roomId: 'multi-instance-room',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
      {
        kind: 'update',
        messageId: 'queued-backend-update',
        origin: 'queued-external-instance',
        principal: null,
        revision: 6,
        sequence: 1,
        sender: 123,
        update: createUpdate('queued'),
      },
    );
    releaseMigration();
    await expect(browser.sync).resolves.toMatchObject({ revision: 6, type: 'sync' });
    await expect(follower.sync).resolves.toMatchObject({ revision: 6, type: 'sync' });
    const browserText = serverA.rooms.get('multi-instance-room')?.doc.getText('root').toString();
    const followerText = serverB.rooms.get('multi-instance-room')?.doc.getText('root').toString();
    expect(browserText).toContain('queued');
    expect(followerText).toContain('queued');
    expect((browserText!.match(/queued/g) || []).length).toBe(1);
    expect((followerText!.match(/queued/g) || []).length).toBe(1);
    browser.socket.close();
    follower.socket.close();
  }, 30_000);

  it('keeps a committed live candidate when publish fails after the owner fence', async () => {
    const snapshot = createSnapshot('legacy');
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const baseBackend = createMemoryCollaborationRoomBackend({
      instanceId: 'publish-failure-instance',
      leaseMs: 1_000,
      requireScope: true,
      snapshotLoader: async () => ({
        revision: snapshot.revision,
        stateVector: new Uint8Array(snapshot.stateVector),
        update: new Uint8Array(snapshot.update),
      }),
      store,
    });
    let leaseAlive = true;
    const backend = {
      ...baseBackend,
      isOwner: async (scope: Parameters<typeof baseBackend.isOwner>[0]) =>
        leaseAlive && baseBackend.isOwner(scope),
      publish: async (...args: Parameters<typeof baseBackend.publish>) => {
        leaseAlive = false;
        await baseBackend.publish(...args);
        throw new Error('ready publish failed');
      },
    };
    const server = createCollaborationServer({
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      migrateLegacyBlockImagesInYjsDoc: createMigration('committed-'),
      roomBackend: backend,
      ticketVerifier: createTicketVerifier,
    });
    servers.push(server);
    const address = await server.listen(0);
    const browser = await authenticate(
      `ws://127.0.0.1:${address.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'browser',
    );
    await expect(browser.sync).resolves.toMatchObject({ revision: 5, type: 'sync' });
    expect(server.rooms.get('multi-instance-room')?.doc.getText('root').toString()).toBe(
      'committed-legacy',
    );
    expect(store.rooms.values().next().value?.snapshot?.bootstrapReady).toBe(true);
    expect(server.getRoomDiagnostics()[0]).toMatchObject({
      backendBootstrapReady: true,
      backendBootstrapRequired: true,
    });
    browser.socket.close();
  });

  it('releases a no-op migration after a publish failure without closing the room', async () => {
    const snapshot = createSnapshot('legacy');
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const baseBackend = createMemoryCollaborationRoomBackend({
      instanceId: 'noop-publish-failure-instance',
      leaseMs: 1_000,
      requireScope: true,
      snapshotLoader: async () => ({
        revision: snapshot.revision,
        stateVector: new Uint8Array(snapshot.stateVector),
        update: new Uint8Array(snapshot.update),
      }),
      store,
    });
    const backend = {
      ...baseBackend,
      publish: async (...args: Parameters<typeof baseBackend.publish>) => {
        await baseBackend.publish(...args);
        throw new Error('no-op ready publish failed');
      },
    };
    const server = createCollaborationServer({
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      migrateLegacyBlockImagesInYjsDoc: async ({ doc }: { doc: Yjs.Doc }) => ({
        changed: false,
        stateVector: new Uint8Array(encodeStateVector(doc)),
        // Yjs encodes an empty update as [0, 0]. It is a valid delta even
        // though the migration made no structural change.
        update: new Uint8Array([0, 0]),
      }),
      roomBackend: backend,
      ticketVerifier: createTicketVerifier,
    });
    servers.push(server);
    const address = await server.listen(0);
    const browser = await authenticate(
      `ws://127.0.0.1:${address.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'browser',
    );
    await expect(browser.sync).resolves.toMatchObject({ revision: 4, type: 'sync' });
    expect(server.rooms.get('multi-instance-room')?.doc.getText('root').toString()).toBe('legacy');
    expect(store.rooms.values().next().value?.snapshot?.bootstrapReady).toBe(true);
    expect(server.getRoomDiagnostics()[0]).toMatchObject({
      backendBootstrapReady: true,
      backendBootstrapRequired: true,
    });
    browser.socket.close();
  });

  it('does not leak a local Yjs mutation when the durable backend rejects the write', async () => {
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const baseBackend = createBackend('failure-instance', store);
    let rejectRevision = true;
    const backend = {
      ...baseBackend,
      allocateRevision: async (scope: Parameters<typeof baseBackend.allocateRevision>[0]) => {
        if (rejectRevision) throw new Error('Redis revision allocation unavailable');
        return baseBackend.allocateRevision(scope);
      },
    };
    const server = createCollaborationServer({
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      roomBackend: backend,
      ticketVerifier: createTicketVerifier,
    });
    servers.push(server);
    const address = await server.listen(0);
    const url = `ws://127.0.0.1:${address.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`;
    const browser = await authenticate(url, 'browser');
    await browser.sync;

    const error = nextMessage(browser.socket);
    const closed = waitForClose(browser.socket);
    browser.socket.send(
      JSON.stringify({
        messageId: 'rejected-backend-update',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('must not leak'),
        version: 1,
      }),
    );
    await expect(error).resolves.toMatchObject({ code: 'backend_unavailable', type: 'error' });
    await expect(closed).resolves.toMatchObject({ code: 1013 });

    rejectRevision = false;
    const reconnected = await authenticate(url, 'browser');
    const sync = await reconnected.sync;
    const restored = new Doc();
    applyUpdate(restored, Buffer.from(String(sync.update), 'base64'));
    expect(restored.getText('root').toString()).not.toContain('must not leak');
    restored.destroy();
    reconnected.socket.close();
  });

  it('reports the durable backend health and fails the health probe closed', async () => {
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const baseBackend = createBackend('health-instance', store);
    let healthy = true;
    const backend = { ...baseBackend, healthy: () => healthy };
    const server = createCollaborationServer({
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      roomBackend: backend,
      ticketVerifier: createTicketVerifier,
    });
    servers.push(server);
    const address = await server.listen(0);

    const initialHealth = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(initialHealth.status).toBe(200);
    expect(await initialHealth.json()).toEqual({ ok: true });

    healthy = false;
    const failedHealth = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(failedHealth.status).toBe(503);
    expect(await failedHealth.json()).toEqual({ ok: false });
    const metrics = await fetch(`http://127.0.0.1:${address.port}/metrics`);
    expect(await metrics.json()).toMatchObject({ backendHealthy: false, backendMode: 'memory' });
  });

  it('waits for backend subscription and owner cleanup before shutdown completes', async () => {
    const store: MemoryRoomBackendStore = { replay: new Map(), rooms: new Map() };
    const baseBackend = createBackend('shutdown-instance', store);
    let releaseCleanup!: () => void;
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let releaseStarted = false;
    const backend = {
      ...baseBackend,
      releaseOwner: async (scope: Parameters<typeof baseBackend.releaseOwner>[0]) => {
        releaseStarted = true;
        await cleanupGate;
        await baseBackend.releaseOwner(scope);
      },
    };
    const server = createCollaborationServer({
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      roomBackend: backend,
      ticketVerifier: createTicketVerifier,
    });
    servers.push(server);
    const address = await server.listen(0);
    const client = await authenticate(
      `ws://127.0.0.1:${address.port}/collaboration/multi-instance-room?protocol=lobe-yjs-v1`,
      'browser',
    );
    await client.sync;

    let closed = false;
    const closePromise = server.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(releaseStarted).toBe(true);
    expect(closed).toBe(false);

    releaseCleanup();
    await closePromise;
    expect(closed).toBe(true);
  });

  it('requires an explicit development memory backend and fails closed in production', async () => {
    await expect(
      createPageCollaborationRoomBackend({ environment: 'development' }),
    ).rejects.toThrow(/PAGE_COLLABORATION_BACKEND=memory/);
    await expect(
      createPageCollaborationRoomBackend({ backend: 'memory', environment: 'production' }),
    ).rejects.toThrow(/not allowed in production/);
    const backend = await createPageCollaborationRoomBackend({
      backend: 'memory',
      environment: 'development',
    });
    expect(backend.mode).toBe('memory');
    await backend.close();
  });
});
