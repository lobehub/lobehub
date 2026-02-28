import './initialize';

import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import SPAGlobalProvider from '@/layout/SPAGlobalProvider';
import { createAppRouter } from '@/utils/router';

import { mobileRoutes } from './app/[variants]/(mobile)/router/mobileRouter.config';

const router = createAppRouter(mobileRoutes);

createRoot(document.getElementById('root')!).render(
  <SPAGlobalProvider>
    <RouterProvider router={router} />
  </SPAGlobalProvider>,
);
