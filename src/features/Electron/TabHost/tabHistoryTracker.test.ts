import { createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import {
  createHistoryTracker,
  type HistoryState,
  initHistoryState,
  reduceHistoryState,
  snapshotOf,
} from './tabHistoryTracker';

const apply = (state: HistoryState, action: 'POP' | 'PUSH' | 'REPLACE', key: string) =>
  reduceHistoryState(state, action, key);

describe('reduceHistoryState', () => {
  it('starts at index 0 with a single key and cannot go back or forward', () => {
    const state = initHistoryState('a');
    expect(state).toEqual({ index: 0, keys: ['a'] });
    expect(snapshotOf(state)).toEqual({ canGoBack: false, canGoForward: false });
  });

  it('PUSH appends a key and advances the index', () => {
    let state = initHistoryState('a');
    state = apply(state, 'PUSH', 'b');
    expect(state).toEqual({ index: 1, keys: ['a', 'b'] });
    expect(snapshotOf(state)).toEqual({ canGoBack: true, canGoForward: false });
  });

  it('PUSH then POP-back keeps forward history and enables canGoForward', () => {
    let state = initHistoryState('a');
    state = apply(state, 'PUSH', 'b');
    state = apply(state, 'POP', 'a');
    expect(state).toEqual({ index: 0, keys: ['a', 'b'] });
    expect(snapshotOf(state)).toEqual({ canGoBack: false, canGoForward: true });
  });

  it('PUSH after a POP-back truncates the forward entries', () => {
    let state = initHistoryState('a');
    state = apply(state, 'PUSH', 'b');
    state = apply(state, 'PUSH', 'c');
    state = apply(state, 'POP', 'b');
    // now at index 1 of [a,b,c]; a new PUSH should drop 'c'
    state = apply(state, 'PUSH', 'd');
    expect(state).toEqual({ index: 2, keys: ['a', 'b', 'd'] });
    expect(snapshotOf(state)).toEqual({ canGoBack: true, canGoForward: false });
  });

  it('REPLACE swaps the current key without changing the index or length', () => {
    let state = initHistoryState('a');
    state = apply(state, 'PUSH', 'b');
    state = apply(state, 'REPLACE', 'b2');
    expect(state).toEqual({ index: 1, keys: ['a', 'b2'] });
    expect(snapshotOf(state)).toEqual({ canGoBack: true, canGoForward: false });
  });

  it('POP to an unknown key leaves the state unchanged', () => {
    let state = initHistoryState('a');
    state = apply(state, 'PUSH', 'b');
    const same = apply(state, 'POP', 'zzz');
    expect(same).toBe(state);
  });
});

describe('createHistoryTracker', () => {
  const makeRouter = (url: string) =>
    createMemoryRouter([{ element: null, path: '/p/:id' }], { initialEntries: [url] });

  it('tracks a single router and reflects push/back transitions', async () => {
    const router = makeRouter('/p/a');
    const tracker = createHistoryTracker(router);

    expect(tracker.getSnapshot()).toEqual({ canGoBack: false, canGoForward: false });

    await router.navigate('/p/b');
    expect(tracker.getSnapshot()).toEqual({ canGoBack: true, canGoForward: false });

    await router.navigate(-1);
    expect(tracker.getSnapshot()).toEqual({ canGoBack: false, canGoForward: true });

    tracker.dispose();
  });

  it('notifies subscribers only when the snapshot changes', async () => {
    const router = makeRouter('/p/a');
    const tracker = createHistoryTracker(router);
    let calls = 0;
    const unsub = tracker.subscribe(() => {
      calls += 1;
    });

    await router.navigate('/p/b');
    expect(calls).toBe(1);
    // REPLACE keeps canGoBack/canGoForward the same → no notification
    await router.navigate('/p/b2', { replace: true });
    expect(calls).toBe(1);

    unsub();
    tracker.dispose();
  });

  it('tracks two routers independently', async () => {
    const routerA = makeRouter('/p/a');
    const routerB = makeRouter('/p/x');
    const trackerA = createHistoryTracker(routerA);
    const trackerB = createHistoryTracker(routerB);

    await routerA.navigate('/p/b');

    expect(trackerA.getSnapshot()).toEqual({ canGoBack: true, canGoForward: false });
    expect(trackerB.getSnapshot()).toEqual({ canGoBack: false, canGoForward: false });

    trackerA.dispose();
    trackerB.dispose();
  });
});
