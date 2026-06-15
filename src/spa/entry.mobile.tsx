import '../initialize';

import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { createAppRouter } from '@/utils/router';

import { mobileRoutes } from './router/mobileRouter.config';

const router = createAppRouter(mobileRoutes);

createRoot(document.getElementById('root')!).render(
  <NextThemeProvider>
    <RouterProvider router={router} />
  </NextThemeProvider>,
);
