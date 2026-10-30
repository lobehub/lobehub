import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { PAGE_ROOM_SYNC_TIMEOUT_MS, PageCollabProvider } from './provider';

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const createMux = () => {
  const sent: any[] = [];
  let handler: any;
  const mux = {
    openDocument: vi.fn((_id: string, h: any) => {
      handler = h;
      return { close: vi.fn(), isReady: () => true, send: (m: any) => sent.push(m) };
    }),
  };
  return {
    deliver: (message: any) => handler.onMessage(message),
    mux,
    ready: () => handler.onReady(),
    sent,
  };
};

const synced = () => ({
  access: 'edit',
  bootstrap: false,
  bootstrapped: true,
  documentId: 'doc_1',
  epoch: 'e1',
  reset: false,
  type: 'doc_synced',
  update: b64(Y.encodeStateAsUpdate(new Y.Doc())),
});

const setup = () => {
  const room = createMux();
  const events = { onAccess: vi.fn(), onFailure: vi.fn(), onStatus: vi.fn() };
  const provider = new PageCollabProvider('doc_1', new Y.Doc(), room.mux as any, events);
  provider.connect();
  room.ready();
  return { events, provider, room };
};

describe('PageCollabProvider failures', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fails when the room never syncs', () => {
    const { events } = setup();

    vi.advanceTimersByTime(PAGE_ROOM_SYNC_TIMEOUT_MS);

    expect(events.onStatus).toHaveBeenLastCalledWith('error');
    expect(events.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'sync_timeout', elapsedMs: PAGE_ROOM_SYNC_TIMEOUT_MS }),
    );
  });

  it('fails when the room refuses the subscription', () => {
    const { events, room } = setup();

    room.deliver({ code: 'internal', documentId: 'doc_1', message: 'boom', type: 'doc_error' });

    expect(events.onStatus).toHaveBeenLastCalledWith('error');
    expect(events.onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'internal', message: 'boom' }),
    );
  });

  it('keeps a view-only member in the room', () => {
    const { events, room } = setup();

    room.deliver({ code: 'read_only', documentId: 'doc_1', message: '', type: 'doc_error' });
    room.deliver(synced());
    vi.advanceTimersByTime(PAGE_ROOM_SYNC_TIMEOUT_MS);

    expect(events.onAccess).toHaveBeenCalledWith('view');
    expect(events.onFailure).not.toHaveBeenCalled();
  });

  it('does not time out once synced', () => {
    const { events, room } = setup();

    room.deliver(synced());
    vi.advanceTimersByTime(PAGE_ROOM_SYNC_TIMEOUT_MS * 2);

    expect(events.onFailure).not.toHaveBeenCalled();
    expect(events.onStatus).toHaveBeenLastCalledWith('synced');
  });

  it('subscribes again on retry and recovers', () => {
    const { events, provider, room } = setup();
    vi.advanceTimersByTime(PAGE_ROOM_SYNC_TIMEOUT_MS);

    provider.retry();
    room.deliver(synced());

    expect(room.sent.filter((m) => m.type === 'doc_subscribe')).toHaveLength(2);
    expect(events.onStatus).toHaveBeenLastCalledWith('synced');
  });
});
