import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getGatewayMux,
  markGatewayMuxUnavailable,
} from '@/store/chat/slices/agentRun/actions/transports/gateway/muxRegistry';

import { subscribeLlmRelayChannel } from './channelSubscription';

vi.mock('@/helpers/gatewayProtocol', () => ({ canUseGatewayProtocolV2: () => true }));
vi.mock('@/services/aiAgent', () => ({ aiAgentService: { issueGatewayUserToken: vi.fn() } }));
vi.mock('@/store/chat/slices/agentRun/actions/transports/gateway/muxRegistry', () => ({
  getGatewayMux: vi.fn(),
  isGatewayMuxUnavailable: () => false,
  markGatewayMuxUnavailable: vi.fn(),
}));

const createMux = () => {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    emit: (event: string, ...args: any[]) => listeners[event]?.forEach((fn) => fn(...args)),
    listeners,
    on: vi.fn((event: string, fn: (...args: any[]) => void) => {
      (listeners[event] ??= []).push(fn);
      return () => {};
    }),
    subscribe: vi.fn(() => ({ on: vi.fn(), unsubscribe: vi.fn() })),
  };
};

describe('subscribeLlmRelayChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A tab that never started a gateway run owns a mux nobody watches: the mux
  // only gives up on protocol v2 (and lets later calls use v1) when someone
  // listens for `unavailable`.
  it('marks protocol v2 unavailable for this gateway when the mux gives up, once per mux', async () => {
    const mux = createMux();
    vi.mocked(getGatewayMux).mockReturnValue(mux as any);

    await subscribeLlmRelayChannel('https://gw', 'llmcall:u:1', vi.fn());
    await subscribeLlmRelayChannel('https://gw', 'llmcall:u:2', vi.fn());
    expect(mux.listeners.unavailable).toHaveLength(1);

    mux.emit('unavailable', 'dial_failed');
    expect(markGatewayMuxUnavailable).toHaveBeenCalledWith({ gatewayUrl: 'https://gw' });
  });
});
