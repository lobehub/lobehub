import '../initialize';

import { RouterProvider } from 'react-router/dom';

import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { bootTiming } from '@/libs/bootTiming';
import { registerLocalDatabaseAdapter } from '@/libs/localDatabase';
import { createElectronLocalDatabaseAdapter } from '@/libs/localDatabase/electronAdapter';
import { createElectronProjectionPersistence } from '@/projection/persistence/electronAdapter';
import { registerProjectionPersistence } from '@/projection/registry';
import { createAppRouter } from '@/utils/router';

import BootShell from './BootShell';
import { isMainLayoutLocation } from './BootShell/routeScope';
import { startAppInitialization } from './initialize/bootstrap';
import { applyDesktopBootstrapIdentity } from './initialize/desktopIdentity';
import { desktopRoutes } from './router/desktopRouter.config';
import { createSPARoot } from './runtime';

registerLocalDatabaseAdapter(createElectronLocalDatabaseAdapter());
registerProjectionPersistence(createElectronProjectionPersistence());
// Must stay synchronous and ahead of the first render: `useCacheScope` reads
// `isIdentityResolved` to pick the cache partition, and on desktop preload is
// the only source that knows it without waiting for `getUserState()`.
applyDesktopBootstrapIdentity();
bootTiming.mark('bundle-eval');
startAppInitialization();

const router = createAppRouter(desktopRoutes);

// Mounting is conditional rather than an early return inside the shell: the hook
// also strips the static logo, and a standalone route needs that logo to stay up
// until its own brand-loading fallback takes over.
const showBootShell = isMainLayoutLocation(desktopRoutes, window.location.pathname);

createSPARoot(document.getElementById('root')!).render(
  <NextThemeProvider>
    {showBootShell && <BootShell />}
    <RouterProvider router={router} />
  </NextThemeProvider>,
);
