interface MarketRouteContext {
  params: Promise<{ segments?: string[] }>;
}

interface MarketProxyRequestInit extends RequestInit {
  duplex?: 'half';
}

const methodsWithoutBody = new Set(['GET', 'HEAD']);

export const dynamic = 'force-dynamic';

const proxyMarketRequest = async (request: Request, context: MarketRouteContext) => {
  const marketBaseUrl = process.env.MARKET_BASE_URL;

  if (!marketBaseUrl) {
    throw new Error('MARKET_BASE_URL is required to proxy Market API requests');
  }

  const { segments = [] } = await context.params;
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(segments.map(encodeURIComponent).join('/'), `${marketBaseUrl}/`);
  targetUrl.search = sourceUrl.search;

  const headers = new Headers(request.headers);
  headers.delete('host');
  const hasBody = !methodsWithoutBody.has(request.method);
  const requestInit: MarketProxyRequestInit = {
    ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
    headers,
    method: request.method,
  };

  return fetch(targetUrl.toString(), requestInit);
};

export const GET = proxyMarketRequest;
export const POST = proxyMarketRequest;
export const PUT = proxyMarketRequest;
export const PATCH = proxyMarketRequest;
export const DELETE = proxyMarketRequest;
export const OPTIONS = proxyMarketRequest;
