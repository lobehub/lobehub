import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiAgentService } from '@/services/aiAgent';
import { shareChatService } from '@/services/shareChat';

import { getGatewayMux, resetGatewayMuxRegistry } from './muxRegistry';

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: { issueGatewayUserToken: vi.fn() },
}));

vi.mock('@/services/shareChat', () => ({
  shareChatService: { issueGatewayUserToken: vi.fn() },
}));

/** Never opens: enough for `connect()` to get past `getToken`. */
class InertWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = InertWebSocket.CONNECTING;
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  constructor(public url: string) {}
  send() {}
  close() {
    this.readyState = InertWebSocket.CLOSED;
  }
}

const GATEWAY_URL = 'https://gateway.test.com';
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('muxRegistry', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', InertWebSocket);
    vi.mocked(aiAgentService.issueGatewayUserToken).mockResolvedValue({ token: 'owner-jwt' });
    vi.mocked(shareChatService.issueGatewayUserToken).mockResolvedValue({ token: 'share-jwt' });
  });

  afterEach(() => {
    resetGatewayMuxRegistry();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns one mux per gatewayUrl + identity', () => {
    const owner = getGatewayMux({ gatewayUrl: GATEWAY_URL });
    expect(getGatewayMux({ gatewayUrl: GATEWAY_URL })).toBe(owner);
    expect(getGatewayMux({ agentShareId: undefined, gatewayUrl: GATEWAY_URL })).toBe(owner);

    const share = getGatewayMux({ agentShareId: 'share-1', gatewayUrl: GATEWAY_URL });
    expect(share).not.toBe(owner);
    expect(getGatewayMux({ agentShareId: 'share-1', gatewayUrl: GATEWAY_URL })).toBe(share);
    expect(getGatewayMux({ agentShareId: 'share-2', gatewayUrl: GATEWAY_URL })).not.toBe(share);
    expect(getGatewayMux({ gatewayUrl: 'https://other.test.com' })).not.toBe(owner);
  });

  it('mints an owner user token for the owner mux', async () => {
    const owner = getGatewayMux({ gatewayUrl: GATEWAY_URL });
    void owner.connect().catch(() => {});
    await flushMicrotasks();

    expect(aiAgentService.issueGatewayUserToken).toHaveBeenCalledTimes(1);
    expect(shareChatService.issueGatewayUserToken).not.toHaveBeenCalled();
  });

  it('mints a share-scoped token for a share visitor mux', async () => {
    const share = getGatewayMux({ agentShareId: 'share-1', gatewayUrl: GATEWAY_URL });
    void share.connect().catch(() => {});
    await flushMicrotasks();

    expect(shareChatService.issueGatewayUserToken).toHaveBeenCalledWith('share-1');
    expect(aiAgentService.issueGatewayUserToken).not.toHaveBeenCalled();
  });

  it('reset disconnects every mux and forgets it', () => {
    const owner = getGatewayMux({ gatewayUrl: GATEWAY_URL });
    const disconnect = vi.spyOn(owner, 'disconnect');

    resetGatewayMuxRegistry();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(getGatewayMux({ gatewayUrl: GATEWAY_URL })).not.toBe(owner);
  });
});
