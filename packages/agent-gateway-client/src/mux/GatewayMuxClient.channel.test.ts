import { afterEach, describe, expect, it, vi } from 'vitest';

import { GatewayMuxClient } from './GatewayMuxClient';

describe('Gateway public Channel notifications', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('receives invalidations without subscribing to a private operation, and unsubscribes cleanly', async () => {
    const sockets: Socket[] = [];
    class Socket {
      static OPEN = 1;
      static CLOSED = 3;
      readyState = 1;
      onmessage?: (event: { data: string }) => void;
      onopen?: () => void;
      sent: string[] = [];
      constructor() {
        sockets.push(this);
      }
      send(data: string) {
        this.sent.push(data);
      }
      close() {
        this.readyState = 3;
      }
      receive(data: unknown) {
        this.onmessage?.({ data: JSON.stringify(data) });
      }
    }
    vi.stubGlobal('WebSocket', Socket);
    const mux = new GatewayMuxClient({
      gatewayUrl: 'http://localhost',
      getToken: async () => 'token',
    });
    const changed = vi.fn();
    const off = mux.on('channel_changed', changed);
    try {
      const connected = mux.connect();
      await vi.waitFor(() => expect(sockets[0]).toBeDefined());
      const socket = sockets[0];
      socket.onopen?.();
      socket.receive({ type: 'ready', protocol: 2, connectionId: 'connection', userId: 'user' });
      await connected;
      const event = { type: 'channel_changed', channelId: 'chn_123456789012' };
      socket.receive(event);
      expect(changed).toHaveBeenCalledExactlyOnceWith(event);
      expect(socket.sent.some((message) => JSON.parse(message).type === 'subscribe')).toBe(false);
      off();
      socket.receive(event);
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      mux.disconnect();
    }
  });
});
