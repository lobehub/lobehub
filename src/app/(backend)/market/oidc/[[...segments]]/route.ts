import { marketOIDCAPIHandler } from '@/server/api-runtime/market';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

type RouteContext = {
  params: Promise<{
    segments?: string[];
  }>;
};

const handleMarketOIDCRoute = async (request: Request, context: RouteContext) => {
  const { segments } = await context.params;

  return createNextAPIRouteHandler(
    'market-oidc',
    (nextRequest) => marketOIDCAPIHandler(nextRequest, { segments }),
    { honoRuntime: 'root' },
  )(request);
};

export const GET = handleMarketOIDCRoute;
export const POST = handleMarketOIDCRoute;

export const dynamic = 'force-dynamic';
