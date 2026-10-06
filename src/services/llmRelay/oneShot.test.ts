import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { describe, expect, it, vi } from 'vitest';

import type { OneShotRelayDeps } from './oneShot';
import { ONE_SHOT_SUBSCRIBE_TIMEOUT_MS, OneShotRelay } from './oneShot';

const createRelay = (overrides: Partial<OneShotRelayDeps> = {}) => {
  let emit!: (event: AgentStreamEvent) => void;
  let markReady!: () => void;
  const close = vi.fn();
  const deps: OneShotRelayDeps = {
    clientId: () => 'tab-1',
    isAvailable: () => true,
    isDeviceProvider: (provider) => provider === 'ollama',
    onCancel: vi.fn(),
    onExecute: vi.fn(),
    subscribe: vi.fn(async (_channel, onEvent) => {
      emit = onEvent;
      return { close, ready: new Promise<void>((resolve) => (markReady = resolve)) };
    }),
    userId: () => 'user-1',
    ...overrides,
  };
  return {
    close,
    deps,
    emit: (e: AgentStreamEvent) => emit(e),
    markReady: () => markReady(),
    relay: new OneShotRelay(deps),
  };
};

describe('OneShotRelay', () => {
  it('makes the request as-is for a provider the server reaches itself', async () => {
    const { deps, relay } = createRelay();
    const request = vi.fn(async () => 'ok');

    expect(await relay.run('openai', request)).toBe('ok');
    expect(request).toHaveBeenCalledWith();
    expect(deps.subscribe).not.toHaveBeenCalled();
  });

  it('makes the request as-is where the deployment cannot relay', async () => {
    const { deps, relay } = createRelay({ isAvailable: () => false });

    await relay.run('ollama', async () => 'ok');
    expect(deps.subscribe).not.toHaveBeenCalled();
  });

  it('subscribes its own channel first, sends it in the headers, executes what it delivers, then releases it', async () => {
    const { close, deps, emit, markReady, relay } = createRelay();
    const request = vi.fn(async (handle?: { channel: string; headers: Record<string, string> }) => {
      emit({ data: { callId: `${handle!.channel}:1` }, type: 'llm_execute' } as any);
      emit({
        data: { callId: `${handle!.channel}:1`, reason: 'timeout' },
        type: 'llm_cancel',
      } as any);
      return 'done';
    });

    const result = relay.run('ollama', request);
    await vi.waitFor(() => expect(deps.subscribe).toHaveBeenCalled());
    // Not sent before the gateway has the subscription.
    expect(request).not.toHaveBeenCalled();
    markReady();

    expect(await result).toBe('done');
    const [channel] = vi.mocked(deps.subscribe).mock.calls[0];
    expect(channel).toMatch(/^llmcall:user-1:[\w-]{8,64}$/);
    expect(request.mock.calls[0][0]).toEqual({
      channel,
      headers: { 'x-lobe-client-id': 'tab-1', 'x-lobe-llm-relay-channel': channel },
    });
    expect(deps.onExecute).toHaveBeenCalledWith({ callId: `${channel}:1` });
    expect(deps.onCancel).toHaveBeenCalledWith({ callId: `${channel}:1`, reason: 'timeout' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('releases the channel when the request fails', async () => {
    const { close, markReady, relay } = createRelay();
    const result = relay.run('ollama', async () => {
      throw new Error('boom');
    });
    markReady();

    await expect(result).rejects.toThrow('boom');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('goes ahead once the subscription takes too long, so the server reports the failure', async () => {
    vi.useFakeTimers();
    try {
      const { relay } = createRelay();
      const request = vi.fn(async () => 'ok');
      const result = relay.run('ollama', request);

      await vi.advanceTimersByTimeAsync(ONE_SHOT_SUBSCRIBE_TIMEOUT_MS);
      expect(await result).toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });
});
