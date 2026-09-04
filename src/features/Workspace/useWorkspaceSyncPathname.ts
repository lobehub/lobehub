'use client';

import { routerSelectors, useRouterStore } from '@/store/router';

// The pathname workspace context follows. Split out purely so the desktop shell
// can override it (`.desktop.ts`): there, workspace context mounts outside the
// per-tab routers, where this router location never moves.
export const useWorkspaceSyncPathname = (): string => useRouterStore(routerSelectors.pathname);
