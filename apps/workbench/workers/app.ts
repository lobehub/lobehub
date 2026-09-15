import { createRequestHandler, RouterContextProvider } from 'react-router';

import { cloudflareContext, type WorkerExecutionContext } from '../app/lib/cloudflareContext';

const API_PREFIXES = ['/api', '/oidc', '/trpc', '/webapi'];

const isApiPath = (pathname: string) =>
  API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
);

export default {
  fetch(request: Request, env: Record<string, unknown>, ctx: WorkerExecutionContext) {
    const url = new URL(request.url);

    // Standalone deployments have no reverse proxy in front: forward the SPA's
    // same-origin API calls to the backend, mirroring vite's dev proxy.
    const apiBase = env.WORKBENCH_API_BASE as string | undefined;
    if (apiBase && isApiPath(url.pathname)) {
      const target = new URL(url.pathname + url.search, apiBase);
      return fetch(new Request(target, request));
    }

    const context = new RouterContextProvider();
    context.set(cloudflareContext, { ctx, env });
    return requestHandler(request, context);
  },
};
