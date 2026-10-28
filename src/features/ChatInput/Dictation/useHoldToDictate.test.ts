import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RealtimeDictationClient } from './client';
import type { RealtimeDictationStatus } from './contract';
import { HOLD_TO_DICTATE_DELAY_MS } from './holdGesture';
import { useHoldToDictate } from './useHoldToDictate';

const store = vi.hoisted(() => {
  const state: { dictationHold?: 'holding' | 'ready' } = {};
  return {
    getState: () => state,
    setState: (patch: Partial<typeof state>) => Object.assign(state, patch),
    state,
  };
});

vi.mock('../store', () => ({ useStoreApi: () => store }));

const createClient = () => {
  const snapshot = { status: 'idle' as RealtimeDictationStatus };
  return {
    cancel: vi.fn(async () => undefined),
    getSnapshot: () => snapshot,
    snapshot,
    stop: vi.fn(async () => undefined),
  };
};

const createEditor = (root: HTMLElement) => ({
  getLexicalEditor: () => ({
    isEditable: () => true,
    registerRootListener: (listener: (root: HTMLElement | null) => void) => {
      listener(root);
      return () => listener(null);
    },
  }),
});

const press = (target: EventTarget, type: string) => {
  const event = new MouseEvent(type, { bubbles: true, button: 0 });
  Object.assign(event, { pointerId: 1, pointerType: 'mouse' });
  target.dispatchEvent(event);
};

describe('useHoldToDictate', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    document.body.append(root);
    store.state.dictationHold = undefined;
  });

  afterEach(() => {
    root.remove();
    vi.useRealTimers();
  });

  const renderHold = (client: ReturnType<typeof createClient>, start = vi.fn()) => {
    const prefetch = vi.fn();
    const hook = renderHook(
      ({ status }: { status: RealtimeDictationStatus }) =>
        useHoldToDictate({
          canStart: true,
          client: client as unknown as RealtimeDictationClient,
          editor: createEditor(root) as any,
          enabled: true,
          prefetch,
          start,
          status,
        }),
      { initialProps: { status: 'idle' as RealtimeDictationStatus } },
    );
    return { ...hook, prefetch, start };
  };

  it('publishes ready, holding and back to ready around a hold', () => {
    const client = createClient();
    const { prefetch, start } = renderHold(client);
    expect(store.state.dictationHold).toBe('ready');

    press(root, 'pointerdown');
    expect(prefetch).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(HOLD_TO_DICTATE_DELAY_MS));
    expect(start).toHaveBeenCalledTimes(1);
    expect(store.state.dictationHold).toBe('holding');

    client.snapshot.status = 'listening';
    press(window, 'pointerup');
    expect(store.state.dictationHold).toBe('ready');
    expect(client.stop).toHaveBeenCalledTimes(1);
  });

  it('finishes a session released while connecting once it starts listening', () => {
    const client = createClient();
    const { rerender } = renderHold(client);

    press(root, 'pointerdown');
    act(() => vi.advanceTimersByTime(HOLD_TO_DICTATE_DELAY_MS));
    client.snapshot.status = 'connecting';
    press(window, 'pointerup');
    expect(client.stop).not.toHaveBeenCalled();

    rerender({ status: 'connecting' });
    expect(client.stop).not.toHaveBeenCalled();
    rerender({ status: 'listening' });
    expect(client.stop).toHaveBeenCalledTimes(1);
  });

  it('abandons the run when released during the microphone permission prompt', () => {
    const client = createClient();
    renderHold(client);

    press(root, 'pointerdown');
    act(() => vi.advanceTimersByTime(HOLD_TO_DICTATE_DELAY_MS));
    client.snapshot.status = 'requesting_permission';
    press(window, 'pointerup');

    expect(client.cancel).toHaveBeenCalledTimes(1);
    expect(client.stop).not.toHaveBeenCalled();
  });

  it('does not start a hold while a session is already running', () => {
    const client = createClient();
    client.snapshot.status = 'listening';
    const { start } = renderHold(client);

    press(root, 'pointerdown');
    act(() => vi.advanceTimersByTime(HOLD_TO_DICTATE_DELAY_MS));

    expect(start).not.toHaveBeenCalled();
  });

  it('clears the published state on unmount', () => {
    const { unmount } = renderHold(createClient());
    unmount();

    expect(store.state.dictationHold).toBeUndefined();
  });
});
