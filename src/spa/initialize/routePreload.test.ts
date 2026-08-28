/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRoutePreloadScheduler, type RoutePreloadTask } from './routePreload';

const createTask = (
  id: string,
  options: Partial<Pick<RoutePreloadTask, 'idleDelay' | 'matches' | 'priority'>> = {},
) => ({
  id,
  idleDelay: options.idleDelay ?? 0,
  load: vi.fn().mockResolvedValue(undefined),
  matches: options.matches ?? (() => false),
  priority: options.priority ?? ('medium' as const),
});

describe('createRoutePreloadScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    window.history.replaceState({}, '', '/agent');

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    Object.defineProperty(window.navigator, 'connection', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: undefined,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preloads eligible routes one at a time in priority order', async () => {
    const executionOrder: string[] = [];
    const low = createTask('low', { priority: 'low' });
    const high = createTask('high', { priority: 'high' });
    low.load.mockImplementation(async () => {
      executionOrder.push('low');
    });
    high.load.mockImplementation(async () => {
      executionOrder.push('high');
    });

    createRoutePreloadScheduler([low, high]).start();
    await vi.runAllTimersAsync();

    expect(executionOrder).toEqual(['high', 'low']);
    expect(high.load).toHaveBeenCalledTimes(1);
    expect(low.load).toHaveBeenCalledTimes(1);
  });

  it('does not preload the route that is already active', async () => {
    const current = createTask('agent', {
      matches: (pathname) => pathname.startsWith('/agent'),
      priority: 'high',
    });
    const next = createTask('settings');

    createRoutePreloadScheduler([current, next]).start();
    await vi.runAllTimersAsync();

    expect(current.load).not.toHaveBeenCalled();
    expect(next.load).toHaveBeenCalledTimes(1);
  });

  it.each([{ effectiveType: 'slow-2g' }, { saveData: true }])(
    'does not preload on a constrained connection: %o',
    async (connection) => {
      Object.defineProperty(window.navigator, 'connection', {
        configurable: true,
        value: connection,
      });
      const task = createTask('settings');

      createRoutePreloadScheduler([task]).start();
      await vi.runAllTimersAsync();

      expect(task.load).not.toHaveBeenCalled();
    },
  );

  it('waits until a hidden document becomes visible', async () => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    const task = createTask('settings');

    createRoutePreloadScheduler([task]).start();
    await vi.runAllTimersAsync();
    expect(task.load).not.toHaveBeenCalled();

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.runAllTimersAsync();

    expect(task.load).toHaveBeenCalledTimes(1);
  });

  it('immediately promotes an intent-only route when its link is targeted', async () => {
    const image = createTask('image', {
      idleDelay: Number.POSITIVE_INFINITY,
      matches: (pathname) => pathname === '/image',
      priority: 'low',
    });
    const anchor = document.createElement('a');
    anchor.href = '/image';
    document.body.append(anchor);

    createRoutePreloadScheduler([image]).start();
    anchor.dispatchEvent(new Event('pointerover', { bubbles: true }));
    await Promise.resolve();

    expect(image.load).toHaveBeenCalledTimes(1);
    anchor.remove();
  });

  it('does not start the same scheduler more than once', async () => {
    const task = createTask('settings');
    const scheduler = createRoutePreloadScheduler([task]);

    scheduler.start();
    scheduler.start();
    await vi.runAllTimersAsync();

    expect(task.load).toHaveBeenCalledTimes(1);
  });
});
