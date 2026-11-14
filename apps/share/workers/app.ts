import { createRequestHandler, RouterContextProvider } from 'react-router';

import { cloudflareContext, type WorkerExecutionContext } from '../app/lib/cloudflareContext';
import { withNoIndexHeader } from './headers';

const API_PREFIXES = ['/api', '/oidc', '/trpc', '/webapi'];

const isApiPath = (pathname: string) =>
  API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
);

export default {
  // `async` because the framework handler answers with a promise: the SSR build transforms this
  // file, and an `await` in a non-async method fails the build with "await is only allowed within
  // async functions" before the worker is ever deployed.
  async fetch(request: Request, env: Record<string, unknown>, ctx: WorkerExecutionContext) {
    const url = new URL(request.url);

    // Standalone deployments have no reverse proxy in front: forward the SPA's
    // same-origin API calls to the backend, mirroring vite's dev proxy.
    const apiBase = env.SHARE_API_BASE as string | undefined;
    if (apiBase && isApiPath(url.pathname)) {
      const target = new URL(url.pathname + url.search, apiBase);
      return fetch(new Request(target, request));
    }

    const context = new RouterContextProvider();
    context.set(cloudflareContext, { ctx, env });

    // Everything the framework answers with is a share page, so all of it stays out of search
    // results. The API branch above proxies the backend and keeps that response's own headers.
    return withNoIndexHeader(await requestHandler(request, context));
  },
};
