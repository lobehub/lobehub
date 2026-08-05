import '../initialize';

import { RouterProvider } from 'react-router/dom';

import BootErrorBoundary from '@/components/BootErrorBoundary';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';

import { authRoutes } from './router/authRouter.config';
import { createSPABrowserRouter, createSPARoot } from './runtime';

const router = createSPABrowserRouter(authRoutes);

createSPARoot(document.getElementById('root')!).render(
  <BootErrorBoundary>
    <NextThemeProvider>
      <RouterProvider router={router} />
    </NextThemeProvider>
  </BootErrorBoundary>,
);
