import '../initialize';

import { RouterProvider } from 'react-router/dom';

import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { bootTiming } from '@/libs/bootTiming';
import { registerLocalDatabaseAdapter } from '@/libs/localDatabase';
import { createElectronLocalDatabaseAdapter } from '@/libs/localDatabase/electronAdapter';
import { createAppRouter } from '@/utils/router';

import BootShell from './BootShell';
import { startAppInitialization } from './initialize/bootstrap';
import { applyDesktopBootstrapIdentity } from './initialize/desktopIdentity';
import { desktopRoutes } from './router/desktopRouter.config';
import { createSPARoot } from './runtime';

registerLocalDatabaseAdapter(createElectronLocalDatabaseAdapter());
// Must stay synchronous and ahead of the first render: `useCacheScope` reads
// `isIdentityResolved` to pick the cache partition, and on desktop preload is
// the only source that knows it without waiting for `getUserState()`.
applyDesktopBootstrapIdentity();
bootTiming.mark('bundle-eval');
startAppInitialization();

const router = createAppRouter(desktopRoutes);

createSPARoot(document.getElementById('root')!).render(
  <NextThemeProvider>
    <BootShell />
    <RouterProvider router={router} />
  </NextThemeProvider>,
);
