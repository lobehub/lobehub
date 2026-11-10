import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { AWARENESS_RENEW_INTERVAL_MS, AWARENESS_TIMEOUT_MS, PageCollabProvider } from './provider';

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

  it('holds its awareness until the room answered the subscribe', () => {
    const { deliver, mux, ready, sent } = createMux();
    const provider = new PageCollabProvider('doc_1', new Y.Doc(), mux as any);

    provider.connect();
    ready();
    provider.awareness.setLocalState({ user: { name: 'A' } });

    expect(sent.filter((m) => m.type === 'doc_awareness')).toEqual([]);

    deliver(synced());

    expect(sent.filter((m) => m.type === 'doc_awareness')).toMatchObject([
      { state: { user: { name: 'A' } }, type: 'doc_awareness' },
    ]);
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
    expect(update.bootstrap).toBeUndefined();
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

  describe('awareness renewal', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const joined = () => {
      vi.useFakeTimers();
      const harness = createMux();
      const provider = new PageCollabProvider('doc_1', new Y.Doc(), harness.mux as any);
      provider.connect();
      harness.ready();
      harness.deliver(synced());
      return { ...harness, provider };
    };
    const awarenessSent = (sent: any[]) => sent.filter((m) => m.type === 'doc_awareness');

    it('re-sends its own state so people who join later still see it', () => {
      const { provider, sent } = joined();
      provider.awareness.setLocalState({ name: 'A' });
      const before = awarenessSent(sent).length;

      vi.advanceTimersByTime(AWARENESS_RENEW_INTERVAL_MS);

      expect(awarenessSent(sent).length).toBe(before + 1);
      expect(awarenessSent(sent).at(-1)).toMatchObject({ state: { name: 'A' } });
    });

    it('stops re-sending once destroyed', () => {
      const { provider, sent } = joined();
      provider.awareness.setLocalState({ name: 'A' });
      provider.destroy();
      const before = sent.length;

      vi.advanceTimersByTime(AWARENESS_RENEW_INTERVAL_MS * 3);

      expect(sent.length).toBe(before);
    });

    it('forgets a peer whose state stopped arriving', () => {
      const { deliver, provider } = joined();
      const onUpdate = vi.fn();
      provider.awareness.on('update', onUpdate);
      deliver({ clientID: 7, documentId: 'doc_1', state: { name: 'B' }, type: 'doc_awareness' });

      vi.advanceTimersByTime(AWARENESS_TIMEOUT_MS + AWARENESS_RENEW_INTERVAL_MS);

      expect(provider.awareness.getStates().has(7)).toBe(false);
      expect(onUpdate).toHaveBeenCalledTimes(2);
    });

    it('keeps the last-known peers while it is offline itself', () => {
      vi.useFakeTimers();
      const harness = createMux();
      const provider = new PageCollabProvider('doc_1', new Y.Doc(), harness.mux as any);
      provider.connect();
      harness.ready();
      harness.deliver(synced());
      harness.deliver({
        clientID: 7,
        documentId: 'doc_1',
        state: { name: 'B' },
        type: 'doc_awareness',
      });

      (harness.mux.openDocument.mock.calls[0][1] as any).onStatus('disconnected');
      vi.advanceTimersByTime(AWARENESS_TIMEOUT_MS * 2);

      expect(provider.awareness.getStates().has(7)).toBe(true);
    });

    it('keeps a peer that keeps renewing', () => {
      const { deliver, provider } = joined();
      const renew = () =>
        deliver({ clientID: 7, documentId: 'doc_1', state: { name: 'B' }, type: 'doc_awareness' });
      renew();

      for (
        let elapsed = 0;
        elapsed < AWARENESS_TIMEOUT_MS * 2;
        elapsed += AWARENESS_RENEW_INTERVAL_MS
      ) {
        vi.advanceTimersByTime(AWARENESS_RENEW_INTERVAL_MS);
        renew();
      }

      expect(provider.awareness.getStates().get(7)).toEqual({ name: 'B' });
    });
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

  it('flags the updates it sends while bootstrapping until the room acks one', async () => {
    const { deliver, mux, ready, sent } = createMux();
    const doc = new Y.Doc();
    const onBootstrap = vi.fn(() => doc.getText('t').insert(0, 'from db'));
    const provider = new PageCollabProvider('doc_1', doc, mux as any, { onBootstrap });

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
    doc.getText('t').insert(0, '+');

    const updates = () => sent.filter((m) => m.type === 'doc_update');
    expect(updates().map((m) => m.bootstrap)).toEqual([true, true]);

    deliver({ documentId: 'doc_1', seq: 1, type: 'doc_ack' });
    doc.getText('t').insert(0, '+');
    expect(updates()[2].bootstrap).toBeUndefined();
  });

  it('flags what the editor writes into an empty room on sync while holding the claim', () => {
    const { deliver, mux, ready, sent } = createMux();
    const doc = new Y.Doc();
    const provider = new PageCollabProvider('doc_1', doc, mux as any);
    provider.on('sync', () => doc.getText('t').insert(0, 'root paragraph'));

    provider.connect();
    ready();
    deliver(
      synced({
        bootstrap: true,
        bootstrapped: false,
        update: b64(Y.encodeStateAsUpdate(new Y.Doc())),
      }),
    );

    expect(sent.filter((m) => m.type === 'doc_update').map((m) => m.bootstrap)).toEqual([true]);
  });

  it('resets once when it lost the bootstrap race', () => {
    const { deliver, mux, ready } = createMux();
    const onReset = vi.fn();
    const provider = new PageCollabProvider('doc_1', new Y.Doc(), mux as any, { onReset });

    provider.connect();
    ready();
    deliver(synced());
    const conflict = {
      code: 'bootstrap_conflict',
      documentId: 'doc_1',
      message: '',
      type: 'doc_error',
    };
    deliver(conflict);
    deliver({ ...conflict });

    expect(onReset).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledWith('bootstrap_conflict');
  });
});
