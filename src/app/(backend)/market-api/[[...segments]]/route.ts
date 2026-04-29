interface MarketRouteContext {
  params: Promise<{ segments?: string[] }>;
}

interface MarketProxyRequestInit extends RequestInit {
  duplex?: 'half';
}

const methodsWithoutBody = new Set(['GET', 'HEAD']);
const proxyHeaderBlocklist = ['authorization', 'cookie', 'host', 'set-cookie'];
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
  for (const header of proxyHeaderBlocklist) {
    headers.delete(header);
  }
  const hasBody = !methodsWithoutBody.has(request.method);
  const requestInit: MarketProxyRequestInit = {
    ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
    headers,
    method: request.method,
  };

  const response = await fetch(targetUrl.toString(), requestInit);

  return sanitizeProxyResponse(response);
};

export const GET = proxyMarketRequest;
export const POST = proxyMarketRequest;
export const PUT = proxyMarketRequest;
export const PATCH = proxyMarketRequest;
export const DELETE = proxyMarketRequest;
export const OPTIONS = proxyMarketRequest;
