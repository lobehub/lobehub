import { createTabRouter } from '@/spa/router/tabRouter';

export type TabRouter = ReturnType<typeof createTabRouter>;

const routers = new Map<string, TabRouter>();

export const getOrCreateTabRouter = (
  tabId: string,
  url: string,
  createRouter: (url: string) => TabRouter = createTabRouter,
): TabRouter => {
  const existing = routers.get(tabId);
  if (existing) return existing;

  const router = createRouter(url);
  routers.set(tabId, router);
  return router;
};

export const disposeTabRouter = (tabId: string): void => {
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
