import '../initialize';

import { RouterProvider } from 'react-router/dom';

import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { bootTiming } from '@/libs/bootTiming';
import { registerLocalDatabaseAdapter } from '@/libs/localDatabase';
import { createElectronLocalDatabaseAdapter } from '@/libs/localDatabase/electronAdapter';
import { createAppRouter } from '@/utils/router';

import { startAppInitialization } from './initialize/bootstrap';
import { reserveTitleBarForFloatingLayers } from './initialize/floatingLayers';
import { popupRoutes } from './router/popupRouter.config';
import { createSPARoot } from './runtime';

registerLocalDatabaseAdapter(createElectronLocalDatabaseAdapter());
bootTiming.mark('bundle-eval');
reserveTitleBarForFloatingLayers();
startAppInitialization();

const router = createAppRouter(popupRoutes);

createSPARoot(document.getElementById('root')!).render(
  <NextThemeProvider>
    <RouterProvider router={router} />
  </NextThemeProvider>,
);
