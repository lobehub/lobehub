import type { createTabRouter } from '@/spa/router/tabRouter';

import {
  createHistoryTracker,
  type HistorySnapshot,
  type HistoryTracker,
} from './tabHistoryTracker';

export type TabRouter = ReturnType<typeof createTabRouter>;

const routers = new Map<string, TabRouter>();
const trackers = new Map<string, HistoryTracker>();

const DEFAULT_HISTORY_SNAPSHOT: HistorySnapshot = { canGoBack: false, canGoForward: false };
const NOOP = () => {};

// `createRouter` is a required injection, not a `= createTabRouter` default: a
// static import of `createTabRouter` here pulls `desktopRouter.config` into the
// boot-time navigation chain and deadlocks module init (jsx-runtime TDZ).
export const getOrCreateTabRouter = (
  tabId: string,
  url: string,
  createRouter: (url: string) => TabRouter,
): TabRouter => {
  const existing = routers.get(tabId);
  if (existing) return existing;

  const router = createRouter(url);
  routers.set(tabId, router);
  trackers.set(tabId, createHistoryTracker(router));
  return router;
};

export const getTabRouter = (tabId: string): TabRouter | undefined => routers.get(tabId);

export const getTabRouterIds = (): string[] => [...routers.keys()];

export const getTabHistorySnapshot = (tabId: string): HistorySnapshot =>
  trackers.get(tabId)?.getSnapshot() ?? DEFAULT_HISTORY_SNAPSHOT;

export const subscribeTabHistory = (tabId: string, listener: () => void): (() => void) =>
  trackers.get(tabId)?.subscribe(listener) ?? NOOP;

export const disposeTabRouter = (tabId: string): void => {
  const tracker = trackers.get(tabId);
  if (tracker) {
    tracker.dispose();
    trackers.delete(tabId);
  }

  const router = routers.get(tabId);
  if (!router) return;

  router.dispose();
  routers.delete(tabId);
};

export const syncTabRouters = (liveTabIds: string[]): void => {
  const live = new Set(liveTabIds);

  for (const tabId of routers.keys()) {
    if (!live.has(tabId)) disposeTabRouter(tabId);
  }
};

export const resetTabRouterManager = (): void => {
  for (const tabId of routers.keys()) disposeTabRouter(tabId);
};
