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
