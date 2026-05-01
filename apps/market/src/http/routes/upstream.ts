import type { Context } from 'hono';
import { Hono } from 'hono';

import type { MarketHonoEnv } from '../../types';
import { getMarketEnv } from '../context';

interface ProxyRequestInit extends RequestInit {
  duplex?: 'half';
}

const methodsWithoutBody = new Set(['GET', 'HEAD']);
const proxyHeaderBlocklist = ['cookie', 'host'];
const responseHeaderBlocklist = ['set-cookie'];

const sanitizeProxyResponse = (response: Response) => {
  const headers = new Headers(response.headers);
  for (const header of responseHeaderBlocklist) {
    headers.delete(header);
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

const proxyToUpstream = async (c: Context<MarketHonoEnv>) => {
  const upstreamBaseUrl = getMarketEnv(c).MARKET_UPSTREAM_BASE_URL;

  if (!upstreamBaseUrl) {
    return c.json(
      {
        error: {
          code: 'not_found',
          message: 'Requested Market endpoint was not found.',
        },
      },
      404,
    );
  }

  const sourceUrl = new URL(c.req.url);
  const targetUrl = new URL(sourceUrl.pathname, upstreamBaseUrl);
  targetUrl.search = sourceUrl.search;

  const headers = new Headers(c.req.raw.headers);
  for (const header of proxyHeaderBlocklist) {
    headers.delete(header);
  }

  const hasBody = !methodsWithoutBody.has(c.req.method);
  const requestInit: ProxyRequestInit = {
    ...(hasBody ? { body: c.req.raw.body, duplex: 'half' } : {}),
    headers,
    method: c.req.method,
  };

  const response = await fetch(targetUrl.toString(), requestInit);

  return sanitizeProxyResponse(response);
};

export const createUpstreamProxyRoutes = () => {
  const app = new Hono<MarketHonoEnv>();

  app.all('/*', proxyToUpstream);

  return app;
};
