import { fetchHonoRuntime } from '@/server/hono-runtime/client';

const HONO_BINDING_PREFIX = '/hono-runtime';
const HONO_BINDING_HEADER = 'x-lobe-dev-hono-binding';

const rewriteHonoBindingRequest = (request: Request) => {
  const url = new URL(request.url);

  if (!url.pathname.startsWith(HONO_BINDING_PREFIX)) return request;

  const pathname = url.pathname.slice(HONO_BINDING_PREFIX.length);
  url.pathname = pathname || '/';

  const init: RequestInit & { duplex?: 'half' } = {
    headers: request.headers,
    method: request.method,
    redirect: request.redirect,
    signal: request.signal,
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }

  return new Request(url, init);
};

const handler = async (request: Request) => {
  const response = await fetchHonoRuntime(rewriteHonoBindingRequest(request));
  const headers = new Headers(response.headers);
  headers.set(HONO_BINDING_HEADER, 'next-catch-all');

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

export const DELETE = handler;
export const GET = handler;
export const HEAD = handler;
export const OPTIONS = handler;
export const PATCH = handler;
export const POST = handler;
export const PUT = handler;
