import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defineCase, llmStep, toolStep } from '../builders/defineCase';
import { MockPlayer } from './MockPlayer';

const fixture = () =>
  defineCase({
    id: 't',
    name: 't',
    steps: [
      llmStep({ text: 'hi', durationMs: 100 }),
      toolStep({
        identifier: 'x',
        apiName: 'y',
        arguments: '{}',
        result: {},
        durationMs: 100,
      }),
    ],
  });

describe('MockPlayer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits no events when idle', () => {
    const onEvent = vi.fn();
    const p = new MockPlayer({ case: fixture(), onEvent, operationId: 'op' });
    expect(p.getState().status).toBe('idle');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('plays through all events at instant speed', async () => {
    const onEvent = vi.fn();
    const p = new MockPlayer({
      case: fixture(),
      onEvent,
      operationId: 'op',
      speedMultiplier: 'instant',
    });
    p.play();
    await vi.runAllTimersAsync();
    expect(p.getState().status).toBe('complete');
    expect(onEvent.mock.calls.length).toBeGreaterThan(0);
    expect(onEvent.mock.calls[0][0].type).toBe('agent_runtime_init');
    expect(onEvent.mock.calls.at(-1)?.[0].type).toBe('agent_runtime_end');
  });

  it('pause halts dispatch; resume continues', async () => {
    const onEvent = vi.fn();
    const p = new MockPlayer({
      case: fixture(),
      onEvent,
      operationId: 'op',
      speedMultiplier: 1,
    });
    p.play();
    await vi.advanceTimersByTimeAsync(0);
    p.pause();
    const dispatchedAtPause = onEvent.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(onEvent.mock.calls.length).toBe(dispatchedAtPause);
    p.resume();
    await vi.runAllTimersAsync();
    expect(p.getState().status).toBe('complete');
  });

  it('stop transitions to idle and discards remaining events', async () => {
    const onEvent = vi.fn();
    const p = new MockPlayer({
      case: fixture(),
      onEvent,
      operationId: 'op',
      speedMultiplier: 1,
    });
    p.play();
    await vi.advanceTimersByTimeAsync(0);
    p.stop();
    const after = onEvent.mock.calls.length;
    await vi.runAllTimersAsync();
    expect(p.getState().status).toBe('idle');
    expect(onEvent.mock.calls.length).toBe(after);
  });

  it('decorates each emitted event with operationId, stepIndex, timestamp', () => {
    const onEvent = vi.fn();
    const p = new MockPlayer({
      case: fixture(),
      onEvent,
      operationId: 'op',
      speedMultiplier: 'instant',
    });
    p.play();
    vi.runAllTimers();
    const calls = onEvent.mock.calls;
    expect(calls[0][0].operationId).toBe('op');
    expect(typeof calls[0][0].timestamp).toBe('number');
    expect(typeof calls[0][0].stepIndex).toBe('number');
  });
});
