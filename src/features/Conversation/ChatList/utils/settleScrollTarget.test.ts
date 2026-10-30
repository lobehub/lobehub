/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { settleScrollTarget } from './settleScrollTarget';

const createScroller = () => {
  const scroller = { scrollTop: 0 } as HTMLElement & { scrollTop: number };
  scroller.addEventListener = vi.fn();
  scroller.removeEventListener = vi.fn();
  return scroller;
};

describe('settleScrollTarget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-aims when the scroller drifts off a target that holds still', async () => {
    const scroller = createScroller();
    const aimAt = vi.fn((target: number) => {
      scroller.scrollTop = target;
    });
    const onDone = vi.fn();
    scroller.scrollTop = 1000;

    settleScrollTarget({
      aimAt,
      initialTarget: 1000,
      isStale: () => false,
      maxMs: 1000,
      onDone,
      quietMs: 150,
      readTarget: () => 1000,
      scroller,
      stopEvents: [],
    });

    await vi.advanceTimersByTimeAsync(32);
    scroller.scrollTop = 2800;
    await vi.advanceTimersByTimeAsync(400);

    expect(aimAt).toHaveBeenLastCalledWith(1000);
    expect(scroller.scrollTop).toBe(1000);
    expect(onDone).toHaveBeenCalled();
  });

  it('settles once the target holds still where the scroller already is', async () => {
    const scroller = createScroller();
    const aimAt = vi.fn();
    const onDone = vi.fn();
    scroller.scrollTop = 1000;

    settleScrollTarget({
      aimAt,
      initialTarget: 1000,
      isStale: () => false,
      maxMs: 1000,
      onDone,
      quietMs: 150,
      readTarget: () => 1000,
      scroller,
      stopEvents: [],
    });

    await vi.advanceTimersByTimeAsync(400);

    expect(aimAt).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
