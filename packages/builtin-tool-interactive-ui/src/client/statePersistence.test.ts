import { describe, expect, it, vi } from 'vitest';

import { createStateSaveQueue } from './statePersistence';

describe('native UI selection persistence', () => {
  it('serializes writes and coalesces rapid changes to the latest state', async () => {
    let finish!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const status = vi.fn();
    const queue = createStateSaveQueue(save, status);
    queue.enqueue({ n: 500 });
    queue.enqueue({ n: 600 });
    queue.enqueue({ n: 1000 });
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith('saved'));
    expect(save.mock.calls.map(([value]) => value)).toEqual([{ n: 500 }, { n: 1000 }]);
  });

  it('surfaces a failed save without automatically replaying it', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const status = vi.fn();
    const queue = createStateSaveQueue(save, status);
    queue.enqueue({ n: 1000 });
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith('failed'));
    expect(save).toHaveBeenCalledTimes(1);
    queue.retry();
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith('saved'));
    expect(save.mock.calls.map(([value]) => value)).toEqual([{ n: 1000 }, { n: 1000 }]);
  });

  it('retries the latest selection after a stale in-flight save fails', async () => {
    let fail!: (error: Error) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const status = vi.fn();
    const queue = createStateSaveQueue(save, status);
    queue.enqueue({ n: 500 });
    queue.enqueue({ n: 1000 });
    fail(new Error('offline'));
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith('failed'));
    queue.retry();
    await vi.waitFor(() => expect(status).toHaveBeenLastCalledWith('saved'));
    expect(save.mock.calls.map(([value]) => value)).toEqual([{ n: 500 }, { n: 1000 }]);
  });
});
