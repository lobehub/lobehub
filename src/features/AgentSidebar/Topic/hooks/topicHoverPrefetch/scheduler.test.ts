import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTopicHoverScheduler,
  HOVER_DWELL_MS,
  NEIGHBOR_FLUSH_MS,
  SCROLL_QUIET_MS,
} from './scheduler';

const ROWS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9'];

const neighborsOf = (topicId: string) => {
  const index = ROWS.indexOf(topicId);
  return ROWS.slice(Math.max(0, index - 2), index + 3).filter((id) => id !== topicId);
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

const setup = () => {
  const prefetchFirstPage = vi.fn((_topicId: string) => Promise.resolve());
  const fetchPreviews = vi.fn((_topicIds: string[]) => Promise.resolve());
  const scheduler = createTopicHoverScheduler({
    canPrefetch: () => true,
    canPreview: () => true,
    fetchPreviews,
    getNeighbors: neighborsOf,
    prefetchFirstPage,
  });
  return { fetchPreviews, prefetchFirstPage, scheduler };
};

describe('createTopicHoverScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when the pointer leaves before the dwell time', () => {
    const { fetchPreviews, prefetchFirstPage, scheduler } = setup();

    scheduler.pointerMove('t4');
    vi.advanceTimersByTime(HOVER_DWELL_MS - 20);
    scheduler.pointerLeave('t4');
    vi.advanceTimersByTime(NEIGHBOR_FLUSH_MS * 2);

    expect(prefetchFirstPage).not.toHaveBeenCalled();
    expect(fetchPreviews).not.toHaveBeenCalled();
  });

  it('prefetches the hovered row at once and its neighbors in one batch after the window', async () => {
    const { fetchPreviews, prefetchFirstPage, scheduler } = setup();

    scheduler.pointerMove('t4');
    vi.advanceTimersByTime(HOVER_DWELL_MS);

    expect(prefetchFirstPage).toHaveBeenCalledWith('t4');
    expect(fetchPreviews).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(NEIGHBOR_FLUSH_MS);

    expect(fetchPreviews).toHaveBeenCalledTimes(1);
    expect(fetchPreviews).toHaveBeenCalledWith(['t2', 't3', 't5', 't6']);
  });

  it('ignores hover intent right after the sidebar scrolls', () => {
    const { fetchPreviews, prefetchFirstPage, scheduler } = setup();

    scheduler.scroll();
    vi.advanceTimersByTime(SCROLL_QUIET_MS - 50);
    scheduler.pointerMove('t4');
    vi.advanceTimersByTime(HOVER_DWELL_MS + NEIGHBOR_FLUSH_MS);

    expect(prefetchFirstPage).not.toHaveBeenCalled();
    expect(fetchPreviews).not.toHaveBeenCalled();
  });

  it('cancels a dwell that a scroll interrupts', () => {
    const { prefetchFirstPage, scheduler } = setup();

    scheduler.pointerMove('t4');
    vi.advanceTimersByTime(HOVER_DWELL_MS / 2);
    scheduler.scroll();
    vi.advanceTimersByTime(HOVER_DWELL_MS);

    expect(prefetchFirstPage).not.toHaveBeenCalled();
  });

  it('keeps one first page in flight and only queues the latest hovered row', async () => {
    const { prefetchFirstPage, scheduler } = setup();
    const first = deferred();
    prefetchFirstPage.mockImplementationOnce(() => first.promise);

    scheduler.focus('t1');
    scheduler.focus('t4');
    scheduler.focus('t8');

    expect(prefetchFirstPage.mock.calls).toEqual([['t1']]);

    first.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(prefetchFirstPage.mock.calls).toEqual([['t1'], ['t8']]);
  });

  it("caps a batch at four, keeping the latest hovered row's neighbors", async () => {
    const { fetchPreviews, scheduler } = setup();

    scheduler.focus('t1');
    scheduler.focus('t7');
    await vi.advanceTimersByTimeAsync(NEIGHBOR_FLUSH_MS);

    expect(fetchPreviews).toHaveBeenCalledTimes(1);
    expect(fetchPreviews.mock.calls[0][0]).toEqual(['t5', 't6', 't8', 't9']);
  });

  it('never previews a row whose first page is being prefetched', async () => {
    const { fetchPreviews, scheduler } = setup();

    scheduler.focus('t4');
    scheduler.focus('t5');
    await vi.advanceTimersByTimeAsync(NEIGHBOR_FLUSH_MS);

    const previewed = fetchPreviews.mock.calls.flatMap(([ids]) => ids);
    expect(previewed).not.toContain('t4');
    expect(previewed).not.toContain('t5');
  });

  it('holds the next batch until the preview request in flight returns', async () => {
    const { fetchPreviews, scheduler } = setup();
    const first = deferred();
    fetchPreviews.mockImplementationOnce(() => first.promise);

    scheduler.focus('t2');
    await vi.advanceTimersByTimeAsync(NEIGHBOR_FLUSH_MS);
    scheduler.focus('t8');
    await vi.advanceTimersByTimeAsync(NEIGHBOR_FLUSH_MS * 2);

    expect(fetchPreviews).toHaveBeenCalledTimes(1);

    first.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchPreviews).toHaveBeenCalledTimes(2);
    expect(fetchPreviews.mock.calls[1][0]).toEqual(['t6', 't7', 't9']);
  });

  it('skips rows the filters reject', async () => {
    const prefetchFirstPage = vi.fn(() => Promise.resolve());
    const fetchPreviews = vi.fn((_topicIds: string[]) => Promise.resolve());
    const scheduler = createTopicHoverScheduler({
      canPrefetch: (id) => id !== 't4',
      canPreview: (id) => id !== 't3',
      fetchPreviews,
      getNeighbors: neighborsOf,
      prefetchFirstPage,
    });

    scheduler.focus('t4');
    await vi.advanceTimersByTimeAsync(NEIGHBOR_FLUSH_MS);

    expect(prefetchFirstPage).not.toHaveBeenCalled();
    expect(fetchPreviews).toHaveBeenCalledWith(['t2', 't5', 't6']);
  });

  it('fires one intent per pointer entry however long the pointer keeps moving', async () => {
    const { fetchPreviews, prefetchFirstPage, scheduler } = setup();

    for (let elapsed = 0; elapsed < 5000; elapsed += 16) {
      scheduler.pointerMove('t4');
      await vi.advanceTimersByTimeAsync(16);
    }

    expect(prefetchFirstPage).toHaveBeenCalledTimes(1);
    expect(fetchPreviews).toHaveBeenCalledTimes(1);

    scheduler.pointerLeave('t4');
    scheduler.pointerMove('t4');
    await vi.advanceTimersByTimeAsync(HOVER_DWELL_MS);

    expect(prefetchFirstPage).toHaveBeenCalledTimes(2);
  });
});
