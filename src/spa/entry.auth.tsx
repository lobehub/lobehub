import '../initialize';

import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import BootErrorBoundary from '@/components/BootErrorBoundary';

import { authRoutes } from './router/authRouter.config';

const router = createBrowserRouter(authRoutes);

createRoot(document.getElementById('root')!).render(
  <BootErrorBoundary>
    <RouterProvider router={router} />
  </BootErrorBoundary>,
);
