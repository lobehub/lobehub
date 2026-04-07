import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayClient } from './client';

// Flag to control mock WS behavior
let mockWsShouldThrow = false;

// Mock ws module — must use dynamic import for EventEmitter to avoid hoisting issues
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 1; // OPEN

    constructor(public url: string) {
      super();
      if (mockWsShouldThrow) {
        mockWsShouldThrow = false;
        throw new Error('connection refused');
      }
      // Simulate async open
      setTimeout(() => this.emit('open'), 0);
    }

    send = vi.fn();
    close = vi.fn();
    override removeAllListeners = vi.fn(() => {
      return this;
    });
  }
  return { default: MockWebSocket };
});

// Mock os
vi.mock('node:os', () => ({
  default: {
    hostname: () => 'test-host',
  },
}));

describe('GatewayClient', () => {
  let client: GatewayClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new GatewayClient({
      autoReconnect: false,
      deviceId: 'test-device-id',
      gatewayUrl: 'https://gateway.test.com',
      serverUrl: 'https://app.test.com',
      token: 'test-token',
      tokenType: 'apiKey',
      userId: 'test-user',
    });
  });

  afterEach(() => {
    client.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should set default values', () => {
      const c = new GatewayClient({ token: 'tok' });
      expect(c.connectionStatus).toBe('disconnected');
      expect(c.currentDeviceId).toBeDefined();
    });

    it('should use provided options', () => {
      expect(client.currentDeviceId).toBe('test-device-id');
      expect(client.connectionStatus).toBe('disconnected');
    });
  });

  describe('connect', () => {
    it('should transition to connecting then authenticating on open', async () => {
      const statusChanges: string[] = [];
      client.on('status_changed', (s) => statusChanges.push(s));

      client.connect();
      expect(client.connectionStatus).toBe('connecting');

      // Let the mock WebSocket emit 'open'
      await vi.advanceTimersByTimeAsync(1);

      expect(client.connectionStatus).toBe('authenticating');
      expect(statusChanges).toContain('connecting');
      expect(statusChanges).toContain('authenticating');

      const ws = (client as any).ws;
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          serverUrl: 'https://app.test.com',
          token: 'test-token',
          tokenType: 'apiKey',
          type: 'auth',
        }),
      );
    });

    it('should not reconnect if already connected', async () => {
      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      // Simulate auth success
      const handler = (client as any).handleMessage;
      handler(JSON.stringify({ type: 'auth_success' }));

      expect(client.connectionStatus).toBe('connected');

      // Calling connect again should be a no-op
      client.connect();
      expect(client.connectionStatus).toBe('connected');
    });

    it('should not reconnect if connecting', () => {
      client.connect();
      expect(client.connectionStatus).toBe('connecting');
      client.connect(); // no-op
      expect(client.connectionStatus).toBe('connecting');
    });

    it('should build correct WebSocket URL with https', () => {
      client.connect();
      const ws = (client as any).ws;
      expect(ws.url).toContain('wss://gateway.test.com/ws');
      expect(ws.url).toContain('deviceId=test-device-id');
      expect(ws.url).toContain('hostname=test-host');
      expect(ws.url).toContain('userId=test-user');
    });

    it('should build ws URL for http gateway', () => {
      const c = new GatewayClient({
        autoReconnect: false,
        gatewayUrl: 'http://localhost:3000',
        token: 'tok',
      });
      c.connect();
      const ws = (c as any).ws;
      expect(ws.url).toContain('ws://localhost:3000/ws');
      c.disconnect();
    });
  });

  describe('message handling', () => {
    let handler: (data: any) => void;

    beforeEach(async () => {
      client.connect();
      await vi.advanceTimersByTimeAsync(1);
      handler = (client as any).handleMessage;
    });

    it('should handle auth_success', () => {
      const connectedCb = vi.fn();
      client.on('connected', connectedCb);

      handler(JSON.stringify({ type: 'auth_success' }));

      expect(client.connectionStatus).toBe('connected');
      expect(connectedCb).toHaveBeenCalled();
    });

    it('should handle auth_failed', () => {
      const authFailedCb = vi.fn();
      client.on('auth_failed', authFailedCb);

      handler(JSON.stringify({ type: 'auth_failed', reason: 'invalid token' }));

      expect(authFailedCb).toHaveBeenCalledWith('invalid token');
    });

    it('should handle auth_failed with no reason', () => {
      const authFailedCb = vi.fn();
      client.on('auth_failed', authFailedCb);

      handler(JSON.stringify({ type: 'auth_failed' }));

      expect(authFailedCb).toHaveBeenCalledWith('Unknown reason');
    });

    it('should handle heartbeat_ack', () => {
      const heartbeatCb = vi.fn();
      client.on('heartbeat_ack', heartbeatCb);

      handler(JSON.stringify({ type: 'heartbeat_ack' }));

      expect(heartbeatCb).toHaveBeenCalled();
    });

    it('should handle tool_call_request', () => {
      const toolCallCb = vi.fn();
      client.on('tool_call_request', toolCallCb);

      const msg = {
        type: 'tool_call_request',
        requestId: 'req-1',
        toolCall: { apiName: 'readFile', arguments: '{}', identifier: 'test' },
      };
      handler(JSON.stringify(msg));

      expect(toolCallCb).toHaveBeenCalledWith(msg);
    });

    it('should handle system_info_request', () => {
      const sysInfoCb = vi.fn();
      client.on('system_info_request', sysInfoCb);

      const msg = { type: 'system_info_request', requestId: 'req-2' };
      handler(JSON.stringify(msg));

      expect(sysInfoCb).toHaveBeenCalledWith(msg);
    });

    it('should handle auth_expired', () => {
      const expiredCb = vi.fn();
      client.on('auth_expired', expiredCb);

      handler(JSON.stringify({ type: 'auth_expired' }));

      expect(expiredCb).toHaveBeenCalled();
    });

    it('should handle unknown message type', () => {
      // Should not throw
      handler(JSON.stringify({ type: 'unknown_type' }));
    });

    it('should handle invalid JSON', () => {
      // Should not throw
      handler('not json');
    });
  });

  describe('disconnect', () => {
    it('should set status to disconnected', async () => {
      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      await client.disconnect();

      expect(client.connectionStatus).toBe('disconnected');
    });
  });

  describe('sendToolCallResponse', () => {
    it('should send tool call response message', async () => {
      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      const ws = (client as any).ws;
      client.sendToolCallResponse({
        requestId: 'req-1',
        result: { content: 'result', success: true },
      });

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          requestId: 'req-1',
          result: { content: 'result', success: true },
          type: 'tool_call_response',
        }),
      );
    });
  });

  describe('sendSystemInfoResponse', () => {
    it('should send system info response message', async () => {
      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      const ws = (client as any).ws;
      client.sendSystemInfoResponse({
        requestId: 'req-2',
        result: {
          success: true,
          systemInfo: {
            arch: 'x64',
            desktopPath: '/home/test/Desktop',
            documentsPath: '/home/test/Documents',
            downloadsPath: '/home/test/Downloads',
            homePath: '/home/test',
            musicPath: '/home/test/Music',
            picturesPath: '/home/test/Pictures',
            userDataPath: '/home/test/.lobehub',
            videosPath: '/home/test/Videos',
            workingDirectory: '/home/test',
          },
        },
      });

      expect(ws.send).toHaveBeenCalled();
      const sentData = JSON.parse(ws.send.mock.calls.at(-1)[0]);
      expect(sentData.type).toBe('system_info_response');
      expect(sentData.requestId).toBe('req-2');
    });
  });

  describe('sendMessage when ws not open', () => {
    it('should not send when ws is null', () => {
      // Not connected, ws is null
      client.sendToolCallResponse({
        requestId: 'req-1',
        result: { content: 'result', success: true },
      });
      // Should not throw
    });

    it('should not send when ws is not OPEN', async () => {
      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      const ws = (client as any).ws;
      ws.readyState = 3; // CLOSED

      client.sendToolCallResponse({
        requestId: 'req-1',
        result: { content: 'result', success: true },
      });

      // send should not have been called after auth message
      // (auth send happens when readyState was OPEN)
      const calls = ws.send.mock.calls;
      // Only the auth message was sent
      expect(calls.length).toBe(1);
    });
  });

  describe('heartbeat', () => {
    it('should send heartbeat after connection', async () => {
      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      const handler = (client as any).handleMessage;
      handler(JSON.stringify({ type: 'auth_success' }));

      const ws = (client as any).ws;
      ws.send.mockClear();

      // Advance 30 seconds for heartbeat
      await vi.advanceTimersByTimeAsync(30_000);

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'heartbeat' }));
    });
  });

  describe('reconnection', () => {
    it('should reconnect on close when autoReconnect is true', async () => {
      const reconnectClient = new GatewayClient({
        autoReconnect: true,
        gatewayUrl: 'https://gateway.test.com',
        token: 'tok',
      });
      const reconnectingCb = vi.fn();
      reconnectClient.on('reconnecting', reconnectingCb);

      reconnectClient.connect();
      await vi.advanceTimersByTimeAsync(1);

      // Simulate close
      const closeHandler = (reconnectClient as any).handleClose;
      closeHandler(1000, Buffer.from('normal'));

      expect(reconnectClient.connectionStatus).toBe('reconnecting');
      expect(reconnectingCb).toHaveBeenCalledWith(1000); // initial delay

      reconnectClient.disconnect();
    });

    it('should not reconnect on intentional disconnect', async () => {
      const reconnectClient = new GatewayClient({
        autoReconnect: true,
        gatewayUrl: 'https://gateway.test.com',
        token: 'tok',
      });

      reconnectClient.connect();
      await vi.advanceTimersByTimeAsync(1);

      await reconnectClient.disconnect();

      const disconnectedCb = vi.fn();
      reconnectClient.on('disconnected', disconnectedCb);

      // handleClose called after disconnect
      const closeHandler = (reconnectClient as any).handleClose;
      closeHandler(1000, Buffer.from(''));

      expect(reconnectClient.connectionStatus).toBe('disconnected');
    });

    it('should use exponential backoff', async () => {
      const reconnectClient = new GatewayClient({
        autoReconnect: true,
        gatewayUrl: 'https://gateway.test.com',
        token: 'tok',
      });
      const delays: number[] = [];
      reconnectClient.on('reconnecting', (delay) => delays.push(delay));

      reconnectClient.connect();
      await vi.advanceTimersByTimeAsync(1);

      // First close → scheduleReconnect with delay=1000, then reconnectDelay doubles to 2000
      const closeHandler = (reconnectClient as any).handleClose;
      closeHandler(1000, Buffer.from(''));
      expect(delays[0]).toBe(1000);

      // Advance to trigger reconnect → doConnect → new WS → 'open' fires → reconnectDelay resets to 1000
      // Then close again → scheduleReconnect with delay=1000 (reset by handleOpen)
      // To test true backoff, we need closes before 'open' fires.
      // Instead, verify the internal reconnectDelay doubles after scheduleReconnect
      expect((reconnectClient as any).reconnectDelay).toBe(2000);

      // Second close without letting open fire first
      closeHandler(1000, Buffer.from(''));
      expect(delays[1]).toBe(2000);
      expect((reconnectClient as any).reconnectDelay).toBe(4000);

      closeHandler(1000, Buffer.from(''));
      expect(delays[2]).toBe(4000);
      expect((reconnectClient as any).reconnectDelay).toBe(8000);

      reconnectClient.disconnect();
    });

    it('should emit disconnected when autoReconnect is false and ws closes', async () => {
      const disconnectedCb = vi.fn();
      client.on('disconnected', disconnectedCb);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      const closeHandler = (client as any).handleClose;
      closeHandler(1000, Buffer.from(''));

      expect(disconnectedCb).toHaveBeenCalled();
    });
  });

  describe('handleError', () => {
    it('should emit error event', async () => {
      const errorCb = vi.fn();
      client.on('error', errorCb);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      const errorHandler = (client as any).handleError;
      errorHandler(new Error('test error'));

      expect(errorCb).toHaveBeenCalledWith(expect.objectContaining({ message: 'test error' }));
    });
  });

  describe('doConnect error', () => {
    it('should handle WebSocket constructor error with autoReconnect false', () => {
      mockWsShouldThrow = true;

      const disconnectedCb = vi.fn();
      const c = new GatewayClient({
        autoReconnect: false,
        gatewayUrl: 'https://gateway.test.com',
        token: 'tok',
      });
      c.on('disconnected', disconnectedCb);

      c.connect();

      expect(c.connectionStatus).toBe('disconnected');
      expect(disconnectedCb).toHaveBeenCalled();
    });

    it('should schedule reconnect on constructor error with autoReconnect true', () => {
      mockWsShouldThrow = true;

      const reconnectingCb = vi.fn();
      const c = new GatewayClient({
        autoReconnect: true,
        gatewayUrl: 'https://gateway.test.com',
        token: 'tok',
      });
      c.on('reconnecting', reconnectingCb);

      c.connect();

      expect(reconnectingCb).toHaveBeenCalled();
      c.disconnect();
    });
  });

  describe('setStatus no-op for same status', () => {
    it('should not emit status_changed if status is the same', () => {
      const statusCb = vi.fn();
      client.on('status_changed', statusCb);

      // Call setStatus with 'disconnected' (already the current status)
      (client as any).setStatus('disconnected');

      expect(statusCb).not.toHaveBeenCalled();
    });
  });

  describe('closeWebSocket edge cases', () => {
    it('should keep suppressing close errors until the socket closes', async () => {
      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      const ws = (client as any).ws;
      ws.readyState = 0; // CONNECTING
      ws.close = vi.fn(() => {
        setTimeout(() => {
          ws.emit('error', new Error('WebSocket was closed before the connection was established'));
          ws.emit('close', 1006, Buffer.from(''));
        }, 0);
      });

      expect(() => (client as any).closeWebSocket()).not.toThrow();
      await vi.advanceTimersByTimeAsync(1);
      expect(ws.close).toHaveBeenCalled();
      expect(() => ws.emit('error', new Error('listener should be removed after close'))).toThrow(
        'listener should be removed after close',
      );
    });

    it('should handle ws.close throwing synchronously', async () => {
      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      const ws = (client as any).ws;
      ws.readyState = 1; // OPEN
      ws.close = vi.fn(() => {
        throw new Error('close failed');
      });

      expect(() => (client as any).closeWebSocket()).not.toThrow();
      expect(ws.close).toHaveBeenCalled();
    });

    it('should handle ws in CLOSED state', async () => {
      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      const ws = (client as any).ws;
      ws.readyState = 3; // CLOSED
      ws.close = vi.fn();

      (client as any).closeWebSocket();
      expect(ws.close).not.toHaveBeenCalled();
    });
  });

  describe('updateToken', () => {
    it('should update the internal token', () => {
      expect((client as any).token).toBe('test-token');
      client.updateToken('new-token');
      expect((client as any).token).toBe('new-token');
    });

    it('should use the new token on next connect', async () => {
      client.updateToken('refreshed-token');
      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      const ws = (client as any).ws;
      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"token":"refreshed-token"'));
    });
  });

  describe('reconnect', () => {
    it('should close existing connection and reconnect', async () => {
      client = new GatewayClient({
        autoReconnect: false,
        gatewayUrl: 'https://gateway.test.com',
        token: 'old-token',
      });

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      const handler = (client as any).handleMessage;
      handler(JSON.stringify({ type: 'auth_success' }));
      expect(client.connectionStatus).toBe('connected');

      // Update token and reconnect
      client.updateToken('new-token');
      await client.reconnect();
      await vi.advanceTimersByTimeAsync(1);

      expect(client.connectionStatus).toBe('authenticating');
      const ws = (client as any).ws;
      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"token":"new-token"'));
    });

    it('should reset reconnect delay', async () => {
      const reconnectClient = new GatewayClient({
        autoReconnect: true,
        gatewayUrl: 'https://gateway.test.com',
        token: 'tok',
      });

      reconnectClient.connect();
      await vi.advanceTimersByTimeAsync(1);

      // Force backoff delay up
      const closeHandler = (reconnectClient as any).handleClose;
      closeHandler(1000, Buffer.from(''));
      closeHandler(1000, Buffer.from(''));
      expect((reconnectClient as any).reconnectDelay).toBe(4000);

      // reconnect() should reset
      await reconnectClient.reconnect();
      expect((reconnectClient as any).reconnectDelay).toBe(1000);

      reconnectClient.disconnect();
    });
  });

  describe('missed heartbeat ack detection', () => {
    it('should force reconnect after exceeding missed heartbeat threshold', async () => {
      const reconnectClient = new GatewayClient({
        autoReconnect: true,
        gatewayUrl: 'https://gateway.test.com',
        token: 'tok',
      });
      const reconnectingCb = vi.fn();
      reconnectClient.on('reconnecting', reconnectingCb);

      reconnectClient.connect();
      await vi.advanceTimersByTimeAsync(1);

      // Authenticate
      const handler = (reconnectClient as any).handleMessage;
      handler(JSON.stringify({ type: 'auth_success' }));
      expect(reconnectClient.connectionStatus).toBe('connected');

      // Advance 4 heartbeat intervals without any ack (30s × 4 = 120s)
      // After 3 missed, the 4th tick triggers forced reconnect
      await vi.advanceTimersByTimeAsync(30_000 * 4);

      expect(reconnectClient.connectionStatus).toBe('reconnecting');
      expect(reconnectingCb).toHaveBeenCalled();

      reconnectClient.disconnect();
    });

    it('should reset missed counter on heartbeat_ack', async () => {
      const reconnectClient = new GatewayClient({
        autoReconnect: true,
        gatewayUrl: 'https://gateway.test.com',
        token: 'tok',
      });

      reconnectClient.connect();
      await vi.advanceTimersByTimeAsync(1);

      const handler = (reconnectClient as any).handleMessage;
      handler(JSON.stringify({ type: 'auth_success' }));

      // 2 heartbeats without ack
      await vi.advanceTimersByTimeAsync(30_000 * 2);
      expect((reconnectClient as any).missedHeartbeats).toBe(2);

      // Receive ack — counter resets
      handler(JSON.stringify({ type: 'heartbeat_ack' }));
      expect((reconnectClient as any).missedHeartbeats).toBe(0);

      reconnectClient.disconnect();
    });

    it('should emit disconnected when autoReconnect is false and heartbeats missed', async () => {
      const disconnectedCb = vi.fn();
      // client has autoReconnect: false
      client.on('disconnected', disconnectedCb);

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      const handler = (client as any).handleMessage;
      handler(JSON.stringify({ type: 'auth_success' }));

      // Advance past threshold: 4 intervals
      await vi.advanceTimersByTimeAsync(30_000 * 4);

      expect(client.connectionStatus).toBe('disconnected');
      expect(disconnectedCb).toHaveBeenCalled();
    });
  });
});
