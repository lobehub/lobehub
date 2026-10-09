import '@/spa/initialize';

import { RouterProvider } from 'react-router/dom';

import BootErrorBoundary from '@/components/BootErrorBoundary';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';
import { setReplicaPersistedHydration } from '@/libs/replica';
import { createSPABrowserRouter, createSPARoot } from '@/spa/runtime';

import { workbenchRoutes } from './router';

// The Workbench runtime never mounts the user store, so a replica's cache scope
// would stay the last-known user's partition — hydrating it would paint a
// previous (possibly server-invalidated) session's private rows. Reads here are
// network-only; authorization is whatever the server answers.
setReplicaPersistedHydration(false);

const router = createSPABrowserRouter(workbenchRoutes);

createSPARoot(document.getElementById('root')!).render(
  <BootErrorBoundary>
    <NextThemeProvider>
      <RouterProvider router={router} />
    </NextThemeProvider>
  </BootErrorBoundary>,
);
