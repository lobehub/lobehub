import { createRequire } from 'node:module';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type * as Yjs from 'yjs';

const require = createRequire(import.meta.url);
const { Doc, encodeStateAsUpdate } = require('yjs') as typeof Yjs;
const { createCollaborationServer } = require('./server.cjs') as {
  createCollaborationServer: (options?: Record<string, unknown>) => {
    cleanupIdleRooms: () => void;
    close: () => Promise<void>;
    listen: (port: number, host?: string) => Promise<{ port: number }>;
    rooms: Map<string, { clients: Set<unknown> }>;
  };
};

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (servers.length > 0) await servers.pop()!.close();
});

const createServer = (options: Record<string, unknown> = {}) => {
  const server = createCollaborationServer(options);
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

    const rooms = await fetch(`http://127.0.0.1:${address.port}/rooms`);
    expect(rooms.status).toBe(200);
    expect(await rooms.json()).toEqual({ rooms: [] });

    const options = await fetch(`http://127.0.0.1:${address.port}/health`, { method: 'OPTIONS' });
    expect(options.status).toBe(204);
    expect(await options.text()).toBe('');
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
});
