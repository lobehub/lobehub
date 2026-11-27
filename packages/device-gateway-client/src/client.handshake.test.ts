import https from 'node:https';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayClient, resolveEnvProxyAgent } from './client';

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 1;

    constructor(
      public url: string,
      public options?: unknown,
    ) {
      super();
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

vi.mock('node:os', () => ({
  default: {
    hostname: () => 'test-host',
  },
}));

describe('GatewayClient handshake', () => {
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

  it('should build correct WebSocket URL with https', () => {
    client.connect();
    const ws = (client as any).ws;
    expect(ws.url).toContain('wss://gateway.test.com/ws');
    expect(ws.url).toContain('deviceId=test-device-id');
    expect(ws.url).toContain('hostname=test-host');
    expect(ws.url).toContain('userId=test-user');
  });

  it('should include connectionId and channel in the URL when provided', () => {
    const c = new GatewayClient({
      autoReconnect: false,
      channel: 'cli',
      connectionId: 'conn-123',
      deviceId: 'dev-1',
      gatewayUrl: 'https://gateway.test.com',
      token: 'tok',
    });
    c.connect();
    const ws = (c as any).ws;
    expect(ws.url).toContain('connectionId=conn-123');
    expect(ws.url).toContain('channel=cli');
    expect(c.currentConnectionId).toBe('conn-123');
    c.disconnect();
  });

  it('reports process.platform in the handshake by default', () => {
    client.connect();
    const ws = (client as any).ws;
    expect(new URL(ws.url).searchParams.get('platform')).toBe(process.platform);
  });

  it('reports an explicit platform over process.platform', () => {
    const c = new GatewayClient({ autoReconnect: false, platform: 'android', token: 'tok' });
    c.connect();
    const ws = (c as any).ws;
    expect(new URL(ws.url).searchParams.get('platform')).toBe('android');
    c.disconnect();
  });

  it('should default connectionId to a generated UUID when omitted', () => {
    const c = new GatewayClient({ autoReconnect: false, token: 'tok' });
    c.connect();
    const ws = (c as any).ws;
    expect(ws.url).toContain(`connectionId=${c.currentConnectionId}`);
    expect(ws.url).not.toContain('channel=');
    c.disconnect();
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

  it('should keep a public path prefix and ignore a trailing slash', () => {
    const c = new GatewayClient({
      autoReconnect: false,
      gatewayUrl: 'https://edge.example.com/device-gateway/',
      token: 'tok',
    });
    c.connect();
    const ws = new URL((c as any).ws.url);
    expect(`${ws.protocol}//${ws.host}${ws.pathname}`).toBe(
      'wss://edge.example.com/device-gateway/ws',
    );
    c.disconnect();
  });

  it('should include user agent header when provided', () => {
    const c = new GatewayClient({
      autoReconnect: false,
      gatewayUrl: 'https://gateway.test.com',
      token: 'tok',
      userAgent: 'LobeHub Desktop/1.2.3',
    });
    c.connect();
    const ws = (c as any).ws;
    expect(ws.options).toEqual({
      handshakeTimeout: 15_000,
      headers: { 'User-Agent': 'LobeHub Desktop/1.2.3' },
    });
    c.disconnect();
  });
});

describe('resolveEnvProxyAgent', () => {
  // ROOT CAUSE:
  //
  // If the CLI ran on a host that reaches the internet only through
  // HTTPS_PROXY (a needy actor VM has no network interface), `fetch` signed
  // in through the proxy in env-proxy mode but the gateway socket failed with
  // `getaddrinfo EAI_AGAIN`, because `ws` dials with its own connection and
  // never uses Node's proxy-aware default agent.
  //
  // Before the fix, the socket always dialed directly.
  // The fix gives `ws` a `proxyEnv` agent in env-proxy mode.
  it('should tunnel a wss socket through the proxy in env-proxy mode', () => {
    const env = { HTTPS_PROXY: 'http://127.0.0.1:3128', NODE_USE_ENV_PROXY: '1' };
    const agent = resolveEnvProxyAgent('wss://gateway.test.com/ws', env);

    expect(agent).toBeInstanceOf(https.Agent);
  });

  it('should dial directly outside env-proxy mode', () => {
    const env = { HTTPS_PROXY: 'http://127.0.0.1:3128' };

    expect(resolveEnvProxyAgent('wss://gateway.test.com/ws', env)).toBeUndefined();
  });

  it('should pass the agent to the socket in env-proxy mode', () => {
    vi.stubEnv('NODE_USE_ENV_PROXY', '1');
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:3128');
    const c = new GatewayClient({
      autoReconnect: false,
      gatewayUrl: 'https://gateway.test.com',
      token: 'tok',
    });
    c.connect();

    expect((c as any).ws.options.agent).toBeInstanceOf(https.Agent);
    c.disconnect();
    vi.unstubAllEnvs();
  });
});
