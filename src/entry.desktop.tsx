import './initialize';

import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import SPAGlobalProvider from '@/layout/SPAGlobalProvider';
import { createAppRouter } from '@/utils/router';

import { desktopRoutes } from './app/[variants]/router/desktopRouter.config';

const router = createAppRouter(desktopRoutes);

createRoot(document.getElementById('root')!).render(
  <SPAGlobalProvider>
    <RouterProvider router={router} />
  </SPAGlobalProvider>,
);
