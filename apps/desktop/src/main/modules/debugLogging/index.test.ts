import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEBUG_LOGGING_DURATION_MS,
  resetDebugLoggingForTest,
  setDebugLogging,
  syncDebugLogging,
} from './index';

const { applyDebugLogging } = vi.hoisted(() => ({ applyDebugLogging: vi.fn() }));
vi.mock('@/utils/structuredLog', () => ({ applyDebugLogging }));
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const createStore = (initial: Record<string, unknown> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    delete: vi.fn((key: string) => void data.delete(key)),
    get: vi.fn((key: string, fallback?: unknown) => (data.has(key) ? data.get(key) : fallback)),
    set: vi.fn((key: string, value: unknown) => void data.set(key, value)),
  } as any;
};

const NOW = Date.parse('2026-11-13T08:00:00.000Z');
const DAY = DEBUG_LOGGING_DURATION_MS['24h'];

describe('debug logging duration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    applyDebugLogging.mockClear();
  });

  afterEach(() => {
    resetDebugLoggingForTest();
    vi.useRealTimers();
  });

  it('turns on for 24 hours, then turns itself off', () => {
    const store = createStore();

    setDebugLogging(store, '24h', NOW);

    expect(store.data.get('debugLoggingEnabled')).toBe(true);
    expect(store.data.get('debugLoggingExpiresAt')).toBe(NOW + DAY);
    expect(applyDebugLogging).toHaveBeenLastCalledWith(true);

    vi.advanceTimersByTime(DAY);

    expect(store.data.get('debugLoggingEnabled')).toBe(false);
    expect(store.data.has('debugLoggingExpiresAt')).toBe(false);
    expect(applyDebugLogging).toHaveBeenLastCalledWith(false);
  });

  it('stays on without an expiry when set to always', () => {
    const store = createStore({ debugLoggingExpiresAt: NOW + 10 });

    setDebugLogging(store, 'always', NOW);
    vi.advanceTimersByTime(DAY * 30);

    expect(store.data.get('debugLoggingEnabled')).toBe(true);
    expect(store.data.has('debugLoggingExpiresAt')).toBe(false);
    expect(applyDebugLogging).toHaveBeenLastCalledWith(true);
  });

  // Settings saved before durations existed have no expiry and keep their state.
  it('keeps a legacy enabled setting on at launch', () => {
    const store = createStore({ debugLoggingEnabled: true });

    syncDebugLogging(store, NOW);

    expect(store.data.get('debugLoggingEnabled')).toBe(true);
    expect(applyDebugLogging).toHaveBeenLastCalledWith(true);
  });

  it('turns off at launch when the duration ended while the app was closed', () => {
    const store = createStore({ debugLoggingEnabled: true, debugLoggingExpiresAt: NOW - 1 });

    syncDebugLogging(store, NOW);

    expect(store.data.get('debugLoggingEnabled')).toBe(false);
    expect(store.data.has('debugLoggingExpiresAt')).toBe(false);
    expect(applyDebugLogging).toHaveBeenLastCalledWith(false);
  });

  it('cancels the pending expiry when turned off early', () => {
    const store = createStore();
    setDebugLogging(store, '24h', NOW);

    setDebugLogging(store, 'off', NOW + 1000);
    setDebugLogging(store, 'always', NOW + 2000);
    vi.advanceTimersByTime(DAY);

    expect(store.data.get('debugLoggingEnabled')).toBe(true);
  });
});
