import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoundedWebSocketFrameQueue, type FrameWebSocket } from './frameQueue';

const frame = () => new ArrayBuffer(6400);

describe('BoundedWebSocketFrameQueue', () => {
  afterEach(() => vi.useRealTimers());

  it('sends immediately when the socket has capacity', () => {
    const socket = { bufferedAmount: 0, readyState: 1, send: vi.fn() } satisfies FrameWebSocket;
    const queue = new BoundedWebSocketFrameQueue(socket);

    expect(queue.enqueue(frame())).toBe(true);
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(queue.pendingFrames).toBe(0);
  });

  it('never buffers more than five frames under backpressure', () => {
    vi.useFakeTimers();
    const socket = {
      bufferedAmount: 6400 * 6,
      readyState: 1,
      send: vi.fn(),
    } satisfies FrameWebSocket;
    const queue = new BoundedWebSocketFrameQueue(socket);

    expect(Array.from({ length: 5 }, () => queue.enqueue(frame()))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(queue.enqueue(frame())).toBe(false);
    expect(queue.pendingFrames).toBe(5);
    expect(socket.send).not.toHaveBeenCalled();

    queue.dispose();
  });

  it('drains queued frames after bufferedAmount falls below the high-water mark', async () => {
    vi.useFakeTimers();
    const socket = {
      bufferedAmount: 64_000,
      readyState: 1,
      send: vi.fn(),
    } satisfies FrameWebSocket;
    const queue = new BoundedWebSocketFrameQueue(socket);
    queue.enqueue(frame());
    const empty = queue.waitForEmpty();

    socket.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(20);
    await expect(empty).resolves.toBeUndefined();
    expect(socket.send).toHaveBeenCalledTimes(1);
  });
});
