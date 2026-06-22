import '../initialize';

import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';

import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { createAppRouter } from '@/utils/router';

import { startAppInitialization } from './initialize/bootstrap';
import { desktopRoutes } from './router/desktopRouter.config';

startAppInitialization();

const router = createAppRouter(desktopRoutes);

createRoot(document.getElementById('root')!).render(
  <NextThemeProvider>
    <RouterProvider router={router} />
  </NextThemeProvider>,
);
