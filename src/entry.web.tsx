import './initialize';

import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import SPAGlobalProvider from '@/layout/SPAGlobalProvider';
import { createAppRouter } from '@/utils/router';

import { desktopRoutes } from './app/[variants]/router/desktopRouter.config';

const debugProxyBase = '/_dangerous_local_dev_proxy';
const basename =
  window.__DEBUG_PROXY__ || window.location.pathname.startsWith(debugProxyBase)
    ? debugProxyBase
    : undefined;

const router = createAppRouter(desktopRoutes, { basename });

createRoot(document.getElementById('root')!).render(
  <SPAGlobalProvider>
    <RouterProvider router={router} />
  </SPAGlobalProvider>,
);
