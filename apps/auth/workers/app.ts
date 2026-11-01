import { resolveRequestLocale } from '@/locales/requestLocale';

import {
  documentPathFor,
  resolveDocumentLocale,
  SPA_FALLBACK_DOCUMENT,
} from '../app/lib/prerender';
import { injectServerConfig, withDocumentLocale } from './document';

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  AUTH_API_BASE?: string;
  AUTH_APP_HOME?: string;
}

const API_PREFIXES = ['/api', '/oidc', '/trpc', '/webapi'];

const AUTH_PATH_PREFIXES = [
  '/signin',
  '/signup',
  '/verify-email',
  '/reset-password',
  '/auth-error',
  '/market-auth-callback',
  '/oauth',
];

const CONFIG_ENDPOINT = '/webapi/auth/spa-config';

const matchesPrefix = (pathname: string, prefixes: string[]) =>
  prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

const isAssetPath = (pathname: string) =>
  pathname.startsWith('/assets/') || pathname.slice(pathname.lastIndexOf('/')).includes('.');

const stripTrailingSlash = (pathname: string) =>
  pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

const loadServerConfig = async (env: Env, request: Request): Promise<unknown | undefined> => {
  if (!env.AUTH_API_BASE) return undefined;

  const target = new URL(CONFIG_ENDPOINT, env.AUTH_API_BASE);

  try {
    // The endpoint answers with `s-maxage`, so the edge cache handles the TTL.
    const response = await fetch(target, {
      headers: { accept: 'application/json', cookie: request.headers.get('cookie') ?? '' },
    });
    if (!response.ok) return undefined;

    return await response.json();
  } catch {
    // A config lookup failure must not take the sign-in page down: the document
    // still renders, and the browser falls back to the config-less state.
    return undefined;
  }
};

const serveDocument = async (request: Request, env: Env, pathname: string) => {
  const locale = resolveDocumentLocale(resolveRequestLocale(request));
  const url = new URL(request.url);

  const documentPath = documentPathFor(pathname, locale);

  const [document, serverConfig] = await Promise.all([
    env.ASSETS.fetch(new Request(new URL(documentPath, url.origin), { headers: request.headers })),
    loadServerConfig(env, request),
  ]);

  if (!document.ok) return document;

  let html = injectServerConfig(await document.text(), serverConfig);

  if (documentPath === SPA_FALLBACK_DOCUMENT) html = withDocumentLocale(html, locale);

  return new Response(html, {
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
};

export default {
  fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const pathname = stripTrailingSlash(url.pathname);

    // Standalone deployments have no reverse proxy in front: forward the app's
    // same-origin API calls to the backend, mirroring vite's dev proxy.
    if (env.AUTH_API_BASE && matchesPrefix(pathname, API_PREFIXES)) {
      const target = new URL(url.pathname + url.search, env.AUTH_API_BASE);

      return fetch(new Request(target, request));
    }

    if (isAssetPath(pathname)) return env.ASSETS.fetch(request);

    if (!matchesPrefix(pathname, AUTH_PATH_PREFIXES))
      return Response.redirect(env.AUTH_APP_HOME || 'https://lobehub.com', 302);

    return serveDocument(request, env, pathname);
  },
};
