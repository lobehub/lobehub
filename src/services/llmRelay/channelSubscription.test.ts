import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getGatewayMux,
  markGatewayMuxUnavailable,
} from '@/store/chat/slices/agentRun/actions/transports/gateway/muxRegistry';

import { subscribeLlmRelayChannel } from './channelSubscription';

vi.mock('@/helpers/gatewayProtocol', () => ({ canUseGatewayProtocolV2: () => true }));
vi.mock('@/services/aiAgent', () => ({
  aiAgentService: { issueGatewayUserToken: vi.fn(async () => ({ token: 'jwt' })) },
}));

const v1Clients = vi.hoisted(() => [] as any[]);
vi.mock('@lobechat/agent-gateway-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AgentStreamClient: vi.fn(function (this: any, options: unknown) {
    const listeners: Record<string, ((...args: any[]) => void)[]> = {};
    this.options = options;
    this.emit = (event: string, ...args: any[]) => listeners[event]?.forEach((fn) => fn(...args));
    this.on = vi.fn((event: string, fn: (...args: any[]) => void) => {
      (listeners[event] ??= []).push(fn);
    });
    this.connect = vi.fn();
    this.disconnect = vi.fn();
    v1Clients.push(this);
  }),
}));
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
      return () => {
        listeners[event] = listeners[event].filter((other) => other !== fn);
      };
    }),
    subscribe: vi.fn(() => ({ on: vi.fn(), unsubscribe: vi.fn() })),
  };
};

describe('subscribeLlmRelayChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    v1Clients.length = 0;
  });

  // A tab that never started a gateway run owns a mux nobody watches: the mux
  // only gives up on protocol v2 (and lets later calls use v1) when someone
  // listens for `unavailable`.
  it('marks protocol v2 unavailable for this gateway when the mux gives up, once per mux', async () => {
    const mux = createMux();
    vi.mocked(getGatewayMux).mockReturnValue(mux as any);

    (await subscribeLlmRelayChannel('https://gw', 'llmcall:u:1', vi.fn())).close();
    (await subscribeLlmRelayChannel('https://gw', 'llmcall:u:2', vi.fn())).close();
    expect(mux.listeners.unavailable).toHaveLength(1);

    mux.emit('unavailable', 'dial_failed');
    expect(markGatewayMuxUnavailable).toHaveBeenCalledWith({ gatewayUrl: 'https://gw' });
  });

  // The mux leaves its subscriptions for their owner to hand off: the channel
  // a request is waiting on moves to a v1 socket, or that request would go
  // out with nobody subscribed.
  it('moves the channel in flight to a v1 socket when the mux gives up', async () => {
    const mux = createMux();
    const v2Subscription = { on: vi.fn(), unsubscribe: vi.fn() };
    mux.subscribe.mockReturnValue(v2Subscription);
    vi.mocked(getGatewayMux).mockReturnValue(mux as any);
    const onEvent = vi.fn();

    const subscription = await subscribeLlmRelayChannel('https://gw', 'llmcall:u:1', onEvent);
    let ready = false;
    void subscription.ready.then(() => (ready = true));

    mux.emit('unavailable', 'dial_failed');
    await vi.waitFor(() => expect(v1Clients).toHaveLength(1));
    expect(v2Subscription.unsubscribe).toHaveBeenCalled();
    expect(v1Clients[0].options).toMatchObject({ operationId: 'llmcall:u:1', token: 'jwt' });
    expect(v1Clients[0].connect).toHaveBeenCalled();

    v1Clients[0].emit('connected');
    await vi.waitFor(() => expect(ready).toBe(true));
    v1Clients[0].emit('agent_event', { type: 'llm_execute' });
    expect(onEvent).toHaveBeenCalledWith({ type: 'llm_execute' });

    subscription.close();
    expect(v1Clients[0].disconnect).toHaveBeenCalled();
  });

  it('does not hand off a channel that was already released', async () => {
    const mux = createMux();
    vi.mocked(getGatewayMux).mockReturnValue(mux as any);

    (await subscribeLlmRelayChannel('https://gw', 'llmcall:u:1', vi.fn())).close();
    mux.emit('unavailable', 'dial_failed');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(v1Clients).toHaveLength(0);
  });
});
