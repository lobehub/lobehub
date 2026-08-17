import '@/spa/initialize';

import { RouterProvider } from 'react-router/dom';

import BootErrorBoundary from '@/components/BootErrorBoundary';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { createSPABrowserRouter, createSPARoot } from '@/spa/runtime';

import { workbenchRoutes } from './router';

const router = createSPABrowserRouter(workbenchRoutes);

createSPARoot(document.getElementById('root')!).render(
  <BootErrorBoundary>
    <NextThemeProvider>
      <RouterProvider router={router} />
    </NextThemeProvider>
  </BootErrorBoundary>,
);
