import { describe, expect, it, vi } from 'vitest';

describe('appReady', () => {
  it('notifies subscribers when readiness changes', async () => {
    vi.resetModules();
    const { getAppReady, setAppReady, subscribeAppReady } = await import('./app');
    const listener = vi.fn();
    const unsubscribe = subscribeAppReady(listener);

    expect(getAppReady()).toBe(false);

    setAppReady(true);
    expect(getAppReady()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    setAppReady(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setAppReady(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
