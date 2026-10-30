import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSaveCoordinator } from './saveCoordinator';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('createSaveCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops a pending autosave when Save is pressed before its delay runs out', async () => {
    const coordinator = createSaveCoordinator();
    const autosave = vi.fn(async () => undefined);

    coordinator.scheduleAuto(autosave, 400);
    await coordinator.beginExplicit();
    await vi.advanceTimersByTimeAsync(1000);
    coordinator.endExplicit();

    expect(autosave).not.toHaveBeenCalled();
  });

  it('lets an autosave already on its way finish before Save writes', async () => {
    const coordinator = createSaveCoordinator();
    const write = deferred();
    const order: string[] = [];

    void coordinator.runAuto(async () => {
      await write.promise;
      order.push('autosave');
    });
    const save = coordinator.beginExplicit().then(() => order.push('save'));

    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([]);
    write.resolve();
    await save;

    expect(order).toEqual(['autosave', 'save']);
  });

  it('keeps autosaves out while Save is running, and lets them back in afterwards', async () => {
    const coordinator = createSaveCoordinator();
    const autosave = vi.fn(async () => undefined);

    await coordinator.beginExplicit();
    expect(coordinator.isExplicit()).toBe(true);
    await coordinator.runAuto(autosave);
    expect(autosave).not.toHaveBeenCalled();

    coordinator.endExplicit();
    await coordinator.runAuto(autosave);
    expect(autosave).toHaveBeenCalledOnce();
  });

  it('never runs two autosaves at once', async () => {
    const coordinator = createSaveCoordinator();
    const write = deferred();
    const second = vi.fn(async () => undefined);

    const first = coordinator.runAuto(() => write.promise);
    await coordinator.runAuto(second);
    write.resolve();
    await first;

    expect(second).not.toHaveBeenCalled();
  });

  it('still lets Save through when the running autosave fails', async () => {
    const coordinator = createSaveCoordinator();

    void coordinator.runAuto(() => Promise.reject(new Error('offline'))).catch(() => undefined);
    await expect(coordinator.beginExplicit()).resolves.toBeUndefined();
  });
});
