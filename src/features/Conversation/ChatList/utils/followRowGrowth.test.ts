import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { followRowGrowth, SETTLE_QUIET_MS } from './followRowGrowth';

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed = new Set<Element>();
  constructor(private callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.observed.add(target);
  }
  unobserve(target: Element) {
    this.observed.delete(target);
  }
  disconnect() {
    this.observed.clear();
  }
  resize(target: Element) {
    if (this.observed.has(target)) this.callback([], this as unknown as ResizeObserver);
  }
}

const resize = (target: Element) => {
  for (const observer of FakeResizeObserver.instances) observer.resize(target);
};

const createList = () => {
  const content = document.createElement('div');
  const row = document.createElement('div');
  content.append(row);
  return { content, row };
};

describe('followRowGrowth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('follows a row that grows after the reply finished, until the rows settle', () => {
    const { content, row } = createList();
    const onGrow = vi.fn();
    const onSettled = vi.fn();
    followRowGrowth(content, { onGrow, onSettled });

    // The card's chart settles its height after the last chunk.
    vi.advanceTimersByTime(SETTLE_QUIET_MS - 100);
    resize(row);
    expect(onGrow).toHaveBeenCalledTimes(1);

    // Each change restarts the quiet window.
    vi.advanceTimersByTime(SETTLE_QUIET_MS - 100);
    expect(onSettled).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('never settles while the reply is still streaming', () => {
    const { content } = createList();
    const onGrow = vi.fn();
    followRowGrowth(content, { onGrow });

    resize(content);
    vi.advanceTimersByTime(SETTLE_QUIET_MS * 4);

    expect(onGrow).toHaveBeenCalledTimes(1);
  });

  it('stops observing and settling once cleaned up', () => {
    const { content, row } = createList();
    const onGrow = vi.fn();
    const onSettled = vi.fn();
    const stop = followRowGrowth(content, { onGrow, onSettled });
    stop();

    resize(row);
    vi.advanceTimersByTime(SETTLE_QUIET_MS * 2);

    expect(onGrow).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });
});
