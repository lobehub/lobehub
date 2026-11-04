import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayMuxClient } from './GatewayMuxClient';
import type { GatewayMuxClientOptions } from './types';

/** Opens on the next tick and then stays silent: the hub never sends `ready`. */
class SilentSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = SilentSocket.CONNECTING;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;

  constructor(public url: string) {
    sockets.push(this);
    setTimeout(() => {
      this.readyState = SilentSocket.OPEN;
      this.onopen?.({});
    }, 0);
  }

  send(): void {}

  close(): void {
    this.closed = true;
    this.readyState = SilentSocket.CLOSED;
    this.onclose?.({ code: 1000, reason: '' });
  }
}

let sockets: SilentSocket[];
let muxes: GatewayMuxClient[];

const createMux = (overrides?: Partial<GatewayMuxClientOptions>) => {
  const mux = new GatewayMuxClient({
    clientId: 'cid',
    gatewayUrl: 'https://gateway.test.com',
    getToken: async () => 'tok',
    ...overrides,
  });
  muxes.push(mux);
  mux.on('error', () => {});
  return mux;
};

beforeEach(() => {
  sockets = [];
  muxes = [];
  vi.stubGlobal('WebSocket', SilentSocket);
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  for (const mux of muxes) mux.disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GatewayMuxClient connectTimeoutMs', () => {
  it('abandons a socket that opens but never gets ready and dials again', async () => {
    const mux = createMux({ connectTimeoutMs: 5000 });
    mux.subscribe('op-1');
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(sockets[0].closed).toBe(true);

    // First backoff: 0.5 * 1000ms cap.
    await vi.advanceTimersByTimeAsync(501);
    expect(sockets).toHaveLength(2);
  });

  it('counts a getToken that never settles as a failed dial toward unavailable', async () => {
    const mux = createMux({
      connectTimeoutMs: 5000,
      getToken: () => new Promise<string>(() => {}),
      maxDialFailures: 1,
    });
    const onUnavailable = vi.fn();
    mux.on('unavailable', onUnavailable);
    mux.subscribe('op-1');

    await vi.advanceTimersByTimeAsync(5000);

    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back after maxDialFailures attempts that each time out waiting for ready', async () => {
    const mux = createMux({ connectTimeoutMs: 5000 });
    const onUnavailable = vi.fn();
    mux.on('unavailable', onUnavailable);
    mux.subscribe('op-1');

    await vi.advanceTimersByTimeAsync(30_000);

    expect(sockets).toHaveLength(3);
    expect(onUnavailable).toHaveBeenCalledOnce();
  });

  it('keeps waiting for ready without the option (the web default)', async () => {
    const mux = createMux();
    mux.subscribe('op-1');

    await vi.advanceTimersByTimeAsync(60_000);

    expect(sockets).toHaveLength(1);
    expect(sockets[0].closed).toBe(false);
  });
});
