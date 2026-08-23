import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type * as Yjs from 'yjs';

const require = createRequire(import.meta.url);
const { Doc, encodeStateAsUpdate } = require('yjs') as typeof Yjs;
const { createCollaborationServer } = require('./server.cjs') as {
  createCollaborationServer: (options?: Record<string, unknown>) => {
    close: () => Promise<void>;
    listen: (port: number) => Promise<{ port: number }>;
    rooms: Map<string, { clients: Set<unknown> }>;
  };
};

const connect = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });

const nextMessage = (socket: WebSocket) =>
  new Promise<Record<string, unknown>>((resolve) => {
    socket.once('message', (message) => resolve(JSON.parse(String(message))));
  });

const connectWithFirstMessage = (url: string) =>
  new Promise<{ message: Record<string, unknown>; socket: WebSocket }>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('message', (message) => resolve({ message: JSON.parse(String(message)), socket }));
    socket.once('error', reject);
  });

describe('page collaboration server', () => {
  it('isolates each document in its own room', async () => {
    const server = createCollaborationServer();
    const address = await server.listen(0);
    const first = await connect(`ws://127.0.0.1:${address.port}/collaboration/doc-a?clientId=1`);
    const second = await connect(`ws://127.0.0.1:${address.port}/collaboration/doc-b?clientId=2`);

    expect(server.rooms.has('doc-a')).toBe(true);
    expect(server.rooms.has('doc-b')).toBe(true);
    expect(server.rooms.get('doc-a')?.clients.size).toBe(1);
    expect(server.rooms.get('doc-b')?.clients.size).toBe(1);

    first.close();
    second.close();
    await server.close();
  });

  it('defers the second initial sync until the bootstrap owner publishes state', async () => {
    const server = createCollaborationServer();
    const address = await server.listen(0);
    const { message: firstMessage, socket: first } = await connectWithFirstMessage(
      `ws://127.0.0.1:${address.port}/collaboration/doc-a?clientId=1`,
    );
    expect(firstMessage.type).toBe('sync');
    const second = await connect(`ws://127.0.0.1:${address.port}/collaboration/doc-a?clientId=2`);
    let secondSynced = false;
    second.once('message', () => {
      secondSynced = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondSynced).toBe(false);

    const doc = new Doc();
    doc.getText('root').insert(0, 'bootstrapped');
    const sync = nextMessage(second);
    first.send(
      JSON.stringify({
        type: 'update',
        update: Buffer.from(encodeStateAsUpdate(doc)).toString('base64'),
      }),
    );
    expect((await sync).type).toBe('sync');

    first.close();
    second.close();
    doc.destroy();
    await server.close();
  });

  it('evicts an empty room after the configured idle ttl', async () => {
    const server = createCollaborationServer({ cleanupIntervalMs: 5, roomIdleTtlMs: 15 });
    const address = await server.listen(0);
    const socket = await connect(
      `ws://127.0.0.1:${address.port}/collaboration/short-lived?clientId=1`,
    );
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.rooms.has('short-lived')).toBe(false);
    await server.close();
  });
});
