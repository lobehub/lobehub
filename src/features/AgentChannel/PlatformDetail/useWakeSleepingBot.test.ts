/**
 * @vitest-environment happy-dom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { supportsWebhookMode, useWakeSleepingBot } from './useWakeSleepingBot';

const mockWakeBot = vi.hoisted(() => vi.fn());

vi.mock('@/services/agentBotProvider', () => ({
  agentBotProviderService: { wakeBot: mockWakeBot },
}));

const onWoke = vi.fn(async () => {});
const render = (status?: string) =>
  renderHook(
    (props: { status?: string }) =>
      useWakeSleepingBot({
        applicationId: 'app-1',
        onWoke,
        platform: 'qq',
        status: props.status as any,
      }),
    { initialProps: { status } },
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockWakeBot.mockResolvedValue({ woke: true });
});

describe('useWakeSleepingBot', () => {
  it('does nothing for a bot that is not asleep', () => {
    const { result } = render('connected');

    expect(result.current).toBeUndefined();
    expect(mockWakeBot).not.toHaveBeenCalled();
  });

  it('wakes a sleeping bot once, refreshes its status, and remembers it slept', async () => {
    const { rerender, result } = render('sleeping');

    await waitFor(() => expect(result.current).toBe('woke'));
    expect(mockWakeBot).toHaveBeenCalledWith({ applicationId: 'app-1', platform: 'qq' });
    expect(onWoke).toHaveBeenCalledTimes(1);

    rerender({ status: 'starting' });
    rerender({ status: 'sleeping' });
    expect(result.current).toBe('woke');
    expect(mockWakeBot).toHaveBeenCalledTimes(1);
  });

  it('reports a failed wake', async () => {
    mockWakeBot.mockRejectedValue(new Error('forbidden'));
    const { result } = render('sleeping');

    await waitFor(() => expect(result.current).toBe('failed'));
  });

  it("keeps each bot's wake result to that bot when the user switches bots", async () => {
    let finishA!: () => void;
    mockWakeBot
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishA = resolve)))
      .mockRejectedValueOnce(new Error('invalid_auth'));

    const { rerender, result } = renderHook(
      (props: { applicationId: string; status: string }) =>
        useWakeSleepingBot({
          applicationId: props.applicationId,
          onWoke,
          platform: 'qq',
          status: props.status as any,
        }),
      { initialProps: { applicationId: 'app-a', status: 'sleeping' } },
    );
    expect(result.current).toBe('waking');

    // Bot B fails to wake while A's wake is still in flight.
    rerender({ applicationId: 'app-b', status: 'sleeping' });
    await waitFor(() => expect(result.current).toBe('failed'));

    // A's late success must not tell B it is awake.
    finishA();
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current).toBe('failed');

    // A connected bot shows no sleep notice at all.
    rerender({ applicationId: 'app-c', status: 'connected' });
    expect(result.current).toBeUndefined();
  });
});

describe('supportsWebhookMode', () => {
  it('reads the connection mode choices from the settings schema', () => {
    const settings = (modes: string[]) =>
      [{ key: 'settings', properties: [{ enum: modes, key: 'connectionMode' }] }] as any;

    expect(supportsWebhookMode(settings(['websocket', 'webhook']))).toBe(true);
    expect(supportsWebhookMode(settings(['websocket']))).toBe(false);
    expect(supportsWebhookMode([])).toBe(false);
  });
});
