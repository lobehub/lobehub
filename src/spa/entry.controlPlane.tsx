import '../initialize';

import { RouterProvider } from 'react-router/dom';

import BootErrorBoundary from '@/components/BootErrorBoundary';
import NextThemeProvider from '@/layout/GlobalProvider/NextThemeProvider';

import { controlPlaneRoutes } from './router/controlPlaneRouter.config';
import { createSPABrowserRouter, createSPARoot } from './runtime';

// Drop any previously registered PWA SW from older control-plane builds that
// NetworkFirst-cached /api/auth and made login look like "no network request".
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) void reg.unregister();
  });
  if (typeof caches !== 'undefined') {
    void caches.keys().then((keys) => {
      for (const key of keys) void caches.delete(key);
    });
  }
}

const router = createSPABrowserRouter(controlPlaneRoutes);

createSPARoot(document.getElementById('root')!).render(
  <BootErrorBoundary>
    <NextThemeProvider>
      <RouterProvider router={router} />
    </NextThemeProvider>
  </BootErrorBoundary>,
);
