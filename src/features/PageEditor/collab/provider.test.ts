import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { PageCollabProvider } from './provider';

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const createMux = () => {
  const sent: any[] = [];
  let handler: any;
  const mux = {
    openDocument: vi.fn((_id: string, h: any) => {
      handler = h;
      return {
        close: vi.fn(),
        isReady: () => true,
        send: (message: any) => {
          sent.push(message);
          return true;
        },
      };
    }),
  };
  return {
    deliver: (message: any) => handler.onMessage(message),
    mux,
    ready: () => handler.onReady(),
    sent,
  };
};

const roomWith = (text: string) => {
  const doc = new Y.Doc();
  doc.getText('t').insert(0, text);
  return doc;
};

const synced = (overrides: Record<string, unknown> = {}) => ({
  access: 'edit',
  bootstrap: false,
  bootstrapped: true,
  documentId: 'doc_1',
  epoch: 'e1',
  reset: false,
  type: 'doc_synced',
  update: b64(Y.encodeStateAsUpdate(roomWith('room'))),
  ...overrides,
});

describe('PageCollabProvider', () => {
  it('subscribes with its state vector and syncs the room state', () => {
    const { deliver, mux, ready, sent } = createMux();
    const doc = new Y.Doc();
    const provider = new PageCollabProvider('doc_1', doc, mux as any);
    const onSync = vi.fn();
    provider.on('sync', onSync);

    provider.connect();
    ready();
    deliver(synced());

    expect(sent[0]).toMatchObject({ documentId: 'doc_1', type: 'doc_subscribe' });
    expect(sent[0].stateVector).toBeTypeOf('string');
    expect(doc.getText('t').toString()).toBe('room');
    expect(onSync).toHaveBeenCalledWith(true);
  });

  it('asks the editor to bootstrap when it holds the claim', async () => {
    const { deliver, mux, ready } = createMux();
    const onBootstrap = vi.fn();
    const provider = new PageCollabProvider('doc_1', new Y.Doc(), mux as any, { onBootstrap });

    provider.connect();
    ready();
    deliver(
      synced({
        bootstrap: true,
        bootstrapped: false,
        update: b64(Y.encodeStateAsUpdate(new Y.Doc())),
      }),
    );

    await Promise.resolve();
    expect(onBootstrap).toHaveBeenCalledOnce();
  });

  it('waits for another collaborator to bootstrap before syncing', () => {
    const { deliver, mux, ready } = createMux();
    const provider = new PageCollabProvider('doc_1', new Y.Doc(), mux as any);
    const onSync = vi.fn();
    provider.on('sync', onSync);

    provider.connect();
    ready();
    deliver(synced({ bootstrapped: false, update: b64(Y.encodeStateAsUpdate(new Y.Doc())) }));
    expect(onSync).not.toHaveBeenCalled();

    deliver({
      documentId: 'doc_1',
      type: 'doc_update',
      update: b64(Y.encodeStateAsUpdate(roomWith('x'))),
    });
    expect(onSync).toHaveBeenCalledWith(true);
  });

  it('sends local edits and tracks them until acked', () => {
    const { deliver, mux, ready, sent } = createMux();
    const doc = new Y.Doc();
    const onPendingChange = vi.fn();
    const provider = new PageCollabProvider('doc_1', doc, mux as any, { onPendingChange });

    provider.connect();
    ready();
    deliver(synced());
    doc.getText('t').insert(0, 'local ');

    const update = sent.find((m) => m.type === 'doc_update');
    expect(update).toMatchObject({ documentId: 'doc_1', seq: 1 });
    expect(provider.pendingCount).toBe(1);

    deliver({ documentId: 'doc_1', seq: 1, type: 'doc_ack' });
    expect(provider.pendingCount).toBe(0);
    expect(onPendingChange).toHaveBeenLastCalledWith(0);
  });

  it('does not echo remote updates back to the room', () => {
    const { deliver, mux, ready, sent } = createMux();
    const provider = new PageCollabProvider('doc_1', new Y.Doc(), mux as any);

    provider.connect();
    ready();
    deliver(synced());

    expect(sent.filter((m) => m.type === 'doc_update')).toHaveLength(0);
  });

  it('relays remote awareness', () => {
    const { deliver, mux, ready } = createMux();
    const provider = new PageCollabProvider('doc_1', new Y.Doc(), mux as any);

    provider.connect();
    ready();
    deliver({ clientID: 42, documentId: 'doc_1', state: { name: 'Ann' }, type: 'doc_awareness' });

    expect(provider.awareness.getStates().get(42)).toEqual({ name: 'Ann' });
  });

  it('reports a reset when the room epoch changed under it', () => {
    const { deliver, mux, ready } = createMux();
    const onReset = vi.fn();
    const provider = new PageCollabProvider('doc_1', new Y.Doc(), mux as any, { onReset });

    provider.connect();
    ready();
    deliver(synced());
    deliver(synced({ epoch: 'e2', reset: true }));

    expect(onReset).toHaveBeenCalledOnce();
  });

  it('replays sync to a listener that subscribes after the room answered', async () => {
    const { deliver, mux, ready } = createMux();
    const provider = new PageCollabProvider('doc_1', new Y.Doc(), mux as any);

    provider.connect();
    ready();
    deliver(synced());
    const late = vi.fn();
    provider.on('sync', late);
    await Promise.resolve();

    expect(late).toHaveBeenCalledWith(true);
  });

  it('drops its bootstrap when room content arrives first', async () => {
    const { deliver, mux, ready } = createMux();
    const onBootstrap = vi.fn();
    const provider = new PageCollabProvider('doc_1', new Y.Doc(), mux as any, { onBootstrap });

    provider.connect();
    ready();
    deliver(
      synced({
        bootstrap: true,
        bootstrapped: false,
        update: b64(Y.encodeStateAsUpdate(new Y.Doc())),
      }),
    );
    deliver({
      documentId: 'doc_1',
      type: 'doc_update',
      update: b64(Y.encodeStateAsUpdate(roomWith('server'))),
    });
    await Promise.resolve();

    expect(onBootstrap).not.toHaveBeenCalled();
  });
});
