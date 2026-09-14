import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type * as Yjs from 'yjs';

import { createRedisCollaborationRoomBackend } from './roomBackend';

const require = createRequire(import.meta.url);
const { Doc, encodeStateAsUpdate, encodeStateVector } = require('yjs') as typeof Yjs;
const { createCollaborationServer } = require('./server.cjs') as {
  createCollaborationServer: (options?: Record<string, unknown>) => {
    close: () => Promise<void>;
    flushRoom: (roomId: string, reason?: string) => Promise<unknown>;
    listen: (port: number, host?: string) => Promise<{ port: number }>;
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

const createUpdate = (text: string) => {
  const doc = new Doc();
  doc.getText('root').insert(0, text);
  const update = Buffer.from(encodeStateAsUpdate(doc)).toString('base64');
  doc.destroy();
  return update;
};

const ticketVerifier = ({
  clientKind,
  documentId,
  requestId,
  roomId,
}: Record<string, unknown>) => ({
  allowed: true,
  clientKind,
  documentId,
  expiresAt: Date.now() + 60_000,
  jti: clientKind === 'agent' ? 'redis-agent-ticket' : 'redis-browser-ticket',
  principal: {
    authoritative: true,
    canWrite: true,
    clientKind,
    documentId,
    requestId: requestId ?? null,
    roomId,
    userId: 'redis-test-user',
    workspaceId: 'redis-test-workspace',
  },
  requestId,
  roomId,
  singleUse: clientKind === 'agent',
});

const authenticate = async (url: string, clientKind: 'agent' | 'browser', requestId?: string) => {
  const result = await connectWithFirstMessage(url);
  const auth = nextMessage(result.socket);
  result.socket.send(
    JSON.stringify({
      clientId: 1,
      clientKind,
      documentId: 'redis-integration-room',
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

const describeRedis = process.env.REDIS_TEST_URL ? describe : describe.skip;

describeRedis('page collaboration Redis integration', () => {
  it('relays two real WS instances, keeps one persistence owner, fails over, and shares replay', async () => {
    const prefix = `page-collaboration-test-${randomUUID()}`;
    const backendA = createRedisCollaborationRoomBackend({
      instanceId: 'redis-test-a',
      leaseMs: 1_500,
      prefix,
      redisUrl: process.env.REDIS_TEST_URL!,
      requireScope: true,
    });
    const backendB = createRedisCollaborationRoomBackend({
      instanceId: 'redis-test-b',
      leaseMs: 1_500,
      prefix,
      redisUrl: process.env.REDIS_TEST_URL!,
      requireScope: true,
    });
    await Promise.all([backendA.initialize(), backendB.initialize()]);
    const writesA: unknown[] = [];
    const writesB: unknown[] = [];
    const createServer = (backend: typeof backendA, writes: unknown[]) => {
      const server = createCollaborationServer({
        logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
        onRoomUpdate: async (event: unknown) => {
          writes.push(event);
          return { status: 'persisted' };
        },
        roomBackend: backend,
        ticketVerifier,
      });
      servers.push(server);
      return server;
    };
    const serverA = createServer(backendA, writesA);
    const serverB = createServer(backendB, writesB);
    const addressA = await serverA.listen(0);
    const addressB = await serverB.listen(0);
    const roomUrl = (port: number) =>
      `ws://127.0.0.1:${port}/collaboration/redis-integration-room?protocol=lobe-yjs-v1`;

    const browser = await authenticate(roomUrl(addressA.port), 'browser');
    await expect(browser.sync).resolves.toMatchObject({ type: 'sync' });
    const agent = await authenticate(roomUrl(addressB.port), 'agent', 'redis-request-1');
    const agentSync = agent.sync;
    const browserAck = nextMessage(browser.socket);
    browser.socket.send(
      JSON.stringify({
        messageId: 'redis-browser-update',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('redis browser update'),
        version: 1,
      }),
    );
    await expect(browserAck).resolves.toMatchObject({ type: 'update-ack' });
    await expect(agentSync).resolves.toMatchObject({ revision: 1, type: 'sync' });

    const browserAwareness = nextMessage(browser.socket);
    agent.socket.send(
      JSON.stringify({
        protocol: 'lobe-yjs-v1',
        sequence: 1,
        state: {
          anchorPos: null,
          awarenessData: {
            documentId: 'redis-integration-room',
            requestId: 'redis-request-1',
            role: 'agent',
            status: 'thinking',
          },
          color: '#7c3aed',
          focusPos: null,
          focusing: true,
          name: 'Redis Agent',
        },
        type: 'awareness',
        version: 1,
      }),
    );
    await expect(browserAwareness).resolves.toMatchObject({ type: 'awareness' });

    await serverA.flushRoom('redis-integration-room', 'redis-owner-test');
    expect(writesA).toHaveLength(1);
    expect(writesB).toHaveLength(0);

    browser.socket.close();
    await serverA.close();
    await new Promise((resolve) => setTimeout(resolve, 1_700));
    const agentAck = nextMessage(agent.socket);
    agent.socket.send(
      JSON.stringify({
        messageId: 'redis-agent-update',
        protocol: 'lobe-yjs-v1',
        type: 'update',
        update: createUpdate('redis failover update'),
        version: 1,
      }),
    );
    await expect(agentAck).resolves.toMatchObject({ type: 'update-ack' });
    await serverB.flushRoom('redis-integration-room', 'redis-failover-test');
    expect(writesB.length).toBeGreaterThanOrEqual(1);
    expect((writesB.at(-1) as { revision?: number }).revision).toBe(2);

    const backendC = createRedisCollaborationRoomBackend({
      instanceId: 'redis-test-c',
      leaseMs: 1_500,
      prefix,
      redisUrl: process.env.REDIS_TEST_URL!,
      requireScope: true,
    });
    await backendC.initialize();
    const serverC = createServer(backendC, []);
    const addressC = await serverC.listen(0);
    const replay = await connectWithFirstMessage(roomUrl(addressC.port));
    const replayError = nextMessage(replay.socket);
    replay.socket.send(
      JSON.stringify({
        clientId: 1,
        clientKind: 'agent',
        documentId: 'redis-integration-room',
        nonce: replay.message.nonce,
        requestId: 'redis-request-1',
        protocol: 'lobe-yjs-v1',
        ticket: 'agent-ticket',
        type: 'auth',
        version: 1,
      }),
    );
    await expect(replayError).resolves.toMatchObject({ code: 'ticket_replayed' });
    replay.socket.close();
    agent.socket.close();
  }, 20_000);

  it('fails health and new authentication closed after its Redis connections are lost', async () => {
    const backend = createRedisCollaborationRoomBackend({
      instanceId: 'redis-outage-instance',
      prefix: `page-collaboration-outage-${randomUUID()}`,
      redisUrl: process.env.REDIS_TEST_URL!,
      requireScope: true,
    });
    await backend.initialize();
    const server = createCollaborationServer({
      logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
      roomBackend: backend,
      ticketVerifier,
    });
    servers.push(server);
    const address = await server.listen(0);

    await backend.close();
    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({ ok: false });

    const result = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/redis-integration-room?protocol=lobe-yjs-v1`,
    );
    const error = nextMessage(result.socket);
    result.socket.send(
      JSON.stringify({
        clientId: 1,
        clientKind: 'browser',
        documentId: 'redis-integration-room',
        nonce: result.message.nonce,
        protocol: 'lobe-yjs-v1',
        ticket: 'browser-ticket',
        type: 'auth',
        version: 1,
      }),
    );
    await expect(error).resolves.toMatchObject({ code: 'backend_unavailable', type: 'error' });
    result.socket.close();
  });

  it('round-trips a bootstrap-ready snapshot through the Redis owner fence', async () => {
    const prefix = `page-collaboration-bootstrap-${randomUUID()}`;
    const scope = {
      documentId: 'redis-bootstrap-roundtrip-room',
      roomId: 'redis-bootstrap-roundtrip-room',
      userId: 'redis-test-user',
      workspaceId: 'redis-test-workspace',
    };
    const source = new Doc();
    source.getText('root').insert(0, 'bootstrap snapshot');
    const update = new Uint8Array(encodeStateAsUpdate(source));
    const stateVector = new Uint8Array(encodeStateVector(source));
    source.destroy();

    const backendA = createRedisCollaborationRoomBackend({
      instanceId: 'redis-bootstrap-owner-a',
      leaseMs: 1_500,
      prefix,
      redisUrl: process.env.REDIS_TEST_URL!,
      requireScope: true,
    });
    const backendB = createRedisCollaborationRoomBackend({
      instanceId: 'redis-bootstrap-owner-b',
      leaseMs: 1_500,
      prefix,
      redisUrl: process.env.REDIS_TEST_URL!,
      requireScope: true,
    });
    try {
      await Promise.all([backendA.initialize(), backendB.initialize()]);
      await expect(backendA.ensureRoom(scope)).resolves.toMatchObject({
        ownerId: 'redis-bootstrap-owner-a',
      });
      await expect(backendB.ensureRoom(scope)).resolves.toMatchObject({
        ownerId: 'redis-bootstrap-owner-a',
      });

      await expect(
        backendA.saveSnapshot(scope, {
          bootstrapReady: true,
          revision: 9,
          stateVector,
          update,
        }),
      ).resolves.toBe(true);
      const follower = await backendB.ensureRoom(scope);
      expect(follower.ownerId).toBe('redis-bootstrap-owner-a');
      expect(follower.bootstrapReady).toBe(true);
      expect(follower.snapshot?.bootstrapReady).toBe(true);
      expect(Buffer.from(follower.snapshot!.stateVector)).toEqual(Buffer.from(stateVector));
      expect(Buffer.from(follower.snapshot!.update)).toEqual(Buffer.from(update));
      expect(await backendB.isOwner(scope)).toBe(false);
      await expect(
        backendB.saveSnapshot(scope, {
          bootstrapReady: true,
          revision: 10,
          stateVector,
          update,
        }),
      ).resolves.toBe(false);

      await backendA.releaseOwner(scope);
      let takeover = await backendB.ensureRoom(scope);
      for (
        let attempt = 0;
        attempt < 20 && takeover.ownerId !== backendB.instanceId;
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        takeover = await backendB.ensureRoom(scope);
      }
      expect(takeover.ownerId).toBe(backendB.instanceId);
      expect(takeover.bootstrapReady).toBe(true);
      expect(takeover.snapshot?.bootstrapReady).toBe(true);
      expect(Buffer.from(takeover.snapshot!.stateVector)).toEqual(Buffer.from(stateVector));
      expect(Buffer.from(takeover.snapshot!.update)).toEqual(Buffer.from(update));
    } finally {
      await Promise.all([backendA.close(), backendB.close()]);
    }
  }, 20_000);
});
