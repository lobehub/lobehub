import { type TabRouter } from './tabRouterManager';

export type HistoryAction = 'POP' | 'PUSH' | 'REPLACE';

export interface HistoryState {
  index: number;
  keys: string[];
}

export interface HistorySnapshot {
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface HistoryTracker {
  dispose: () => void;
  getSnapshot: () => HistorySnapshot;
  subscribe: (listener: () => void) => () => void;
}

export const initHistoryState = (key: string): HistoryState => ({ index: 0, keys: [key] });

export const reduceHistoryState = (
  state: HistoryState,
  action: HistoryAction,
  key: string,
): HistoryState => {
  switch (action) {
    case 'PUSH': {
      const keys = [...state.keys.slice(0, state.index + 1), key];
      return { index: keys.length - 1, keys };
    }
    case 'REPLACE': {
      const keys = [...state.keys];
      keys[state.index] = key;
      return { index: state.index, keys };
    }
    case 'POP': {
      const index = state.keys.indexOf(key);
      return index === -1 ? state : { index, keys: state.keys };
    }
    default: {
      return state;
    }
  }
};

export const snapshotOf = (state: HistoryState): HistorySnapshot => ({
  canGoBack: state.index > 0,
  canGoForward: state.index < state.keys.length - 1,
});

export const createHistoryTracker = (router: TabRouter): HistoryTracker => {
  let state = initHistoryState(router.state.location.key);
  let snapshot = snapshotOf(state);
  const listeners = new Set<() => void>();

  const unsubscribeRouter = router.subscribe((routerState) => {
    state = reduceHistoryState(
      state,
      routerState.historyAction as HistoryAction,
      routerState.location.key,
    );
    const next = snapshotOf(state);
    if (next.canGoBack === snapshot.canGoBack && next.canGoForward === snapshot.canGoForward) {
      return;
    }
    snapshot = next;
    listeners.forEach((listener) => listener());
  });

  return {
    dispose: () => {
      unsubscribeRouter();
      listeners.clear();
    },
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
